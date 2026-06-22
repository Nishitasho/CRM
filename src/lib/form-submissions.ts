import {
  BookingOrigin,
  BookingStatus,
  CalendarSyncStatus,
  DealParticipantRole,
  DealStatus,
  OperationalEventType,
  Prisma,
  SalesPerformanceEventType,
} from "@prisma/client";
import { BadRequestError } from "./api";
import { createRecordActivity } from "./crm";
import {
  mapFormPayload,
  publicPayloadFromBody,
  validateSubmissionFields,
} from "./form-mapping";
import { syncBookingToGoogle } from "./google-calendar";
import { prisma } from "./prisma";
import {
  linkPrimaryRecords,
  matchOrCreateCompany,
  matchOrCreateContact,
} from "./record-matching";
import { executeRouting } from "./routing";
import { consumeBookingHold, getActiveHoldRanges, getBookingBusyRanges, rangesOverlap } from "./scheduling";
import { formFieldSchema } from "./validation";

type Tx = Prisma.TransactionClient;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function inputJson(value: unknown) {
  return value as Prisma.InputJsonValue;
}

function publicBody(body: Record<string, unknown>) {
  const payload = publicPayloadFromBody(body);
  return {
    payload,
    idempotencyKey:
      typeof body.idempotencyKey === "string" ? body.idempotencyKey : null,
    honeypot: typeof body.honeypot === "string" ? body.honeypot : "",
    consentAccepted: body.consentAccepted === true,
  };
}

async function currentFormVersion(tx: Tx, form: {
  id: string;
  organizationId: string;
  businessUnitId: string | null;
  publishedVersionId: string | null;
  name: string;
  description: string | null;
  fields: Prisma.JsonValue;
  mappingSchema: Prisma.JsonValue;
  routingConfig: Prisma.JsonValue;
  schedulingConfig: Prisma.JsonValue;
  submitButtonText: string;
  completionMessage: string | null;
}) {
  if (form.publishedVersionId) {
    const version = await tx.formVersion.findFirst({
      where: {
        id: form.publishedVersionId,
        organizationId: form.organizationId,
        formId: form.id,
      },
    });
    if (version) return version;
  }
  const latest = await tx.formVersion.findFirst({
    where: { formId: form.id },
    orderBy: { version: "desc" },
  });
  return tx.formVersion.create({
    data: {
      organizationId: form.organizationId,
      businessUnitId: form.businessUnitId,
      formId: form.id,
      version: (latest?.version ?? 0) + 1,
      status: "PUBLISHED",
      nameSnapshot: form.name,
      descriptionSnapshot: form.description,
      fieldSchema: inputJson(form.fields),
      mappingSchema: inputJson(form.mappingSchema),
      routingConfigSnapshot: inputJson(form.routingConfig),
      schedulingConfigSnapshot: inputJson(form.schedulingConfig),
      submitButtonTextSnapshot: form.submitButtonText,
      completionMessageSnapshot: form.completionMessage,
      publishedAt: new Date(),
    },
  });
}

export async function publishForm(input: {
  organizationId: string;
  formId: string;
  userId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const form = await tx.form.findFirst({
      where: { id: input.formId, organizationId: input.organizationId },
    });
    if (!form) throw new BadRequestError("フォームが見つかりません。");
    if (!form.businessUnitId) {
      throw new BadRequestError("フォームを公開するには事業部を選択してください。");
    }
    const latest = await tx.formVersion.findFirst({
      where: { formId: form.id },
      orderBy: { version: "desc" },
    });
    const version = await tx.formVersion.create({
      data: {
        organizationId: form.organizationId,
        businessUnitId: form.businessUnitId,
        formId: form.id,
        version: (latest?.version ?? 0) + 1,
        status: "PUBLISHED",
        nameSnapshot: form.name,
        descriptionSnapshot: form.description,
        fieldSchema: inputJson(form.fields),
        mappingSchema: inputJson(form.mappingSchema),
        routingConfigSnapshot: inputJson(form.routingConfig),
        schedulingConfigSnapshot: inputJson(form.schedulingConfig),
        submitButtonTextSnapshot: form.submitButtonText,
        completionMessageSnapshot: form.completionMessage,
        publishedByUserId: input.userId,
        publishedAt: new Date(),
      },
    });
    await tx.formVersion.updateMany({
      where: {
        formId: form.id,
        id: { not: version.id },
        status: "PUBLISHED",
      },
      data: { status: "ARCHIVED" },
    });
    const item = await tx.form.update({
      where: { id: form.id },
      data: { publishedVersionId: version.id, status: "PUBLISHED" },
    });
    await tx.auditLog.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.userId,
        action: "FORM_PUBLISHED",
        targetType: "FORM",
        targetId: form.id,
        after: { version: version.version },
      },
    });
    return { item, version };
  });
}

async function resolveDealStage(
  tx: Tx,
  input: {
    organizationId: string;
    businessUnitId: string | null;
    pipelineId?: string | null;
    stageId?: string | null;
  },
) {
  const stage = input.stageId
    ? await tx.pipelineStage.findFirst({
        where: {
          id: input.stageId,
          organizationId: input.organizationId,
          ...(input.pipelineId ? { pipelineId: input.pipelineId } : {}),
        },
        include: { pipeline: true },
      })
    : null;
  if (stage) return stage;
  const pipeline = input.pipelineId
    ? await tx.pipeline.findFirst({
        where: { id: input.pipelineId, organizationId: input.organizationId },
      })
    : await tx.pipeline.findFirst({
        where: {
          organizationId: input.organizationId,
          ...(input.businessUnitId ? { businessUnitId: input.businessUnitId } : {}),
          isDefault: true,
        },
        orderBy: { createdAt: "asc" },
      });
  if (!pipeline) return null;
  return tx.pipelineStage.findFirst({
    where: { organizationId: input.organizationId, pipelineId: pipeline.id },
    include: { pipeline: true },
    orderBy: { sortOrder: "asc" },
  });
}

async function createDealFromSubmission(
  tx: Tx,
  input: {
    organizationId: string;
    businessUnitId: string | null;
    ownerUserId: string | null;
    formName: string;
    companyName?: string | null;
    contactName?: string | null;
    mappedDeal: ReturnType<typeof mapFormPayload>["deal"];
    productId?: string | null;
    pipelineId?: string | null;
    stageId?: string | null;
  },
) {
  const stage = await resolveDealStage(tx, input);
  if (!stage) return null;
  const name =
    input.mappedDeal.name ||
    `${input.companyName || input.contactName || "フォーム送信"} / ${input.formName}`;
  const deal = await tx.deal.create({
    data: {
      organizationId: input.organizationId,
      businessUnitId: stage.pipeline.businessUnitId ?? input.businessUnitId,
      ownerUserId: input.ownerUserId,
      pipelineId: stage.pipelineId,
      stageId: stage.id,
      forecastCategoryId: input.mappedDeal.forecastCategoryId ?? null,
      name,
      amount: input.mappedDeal.amount ?? null,
      probability: stage.probability,
      status: stage.stageType === "WON" ? DealStatus.WON : DealStatus.OPEN,
      source: input.mappedDeal.source ?? `フォーム: ${input.formName}`,
      customFields: inputJson(input.mappedDeal.customFields),
    },
  });
  if (input.productId || input.mappedDeal.productId) {
    await tx.dealLineItem.create({
      data: {
        organizationId: input.organizationId,
        dealId: deal.id,
        productId: input.mappedDeal.productId ?? input.productId ?? null,
        businessUnitId: deal.businessUnitId,
        name: "フォーム受付商材",
        quantity: 1,
        revenueAmount: input.mappedDeal.amount ?? null,
        expectedGrossProfitAmount: input.mappedDeal.expectedGrossProfitAmount ?? null,
        source: "FORM",
      },
    });
  }
  if (input.ownerUserId) {
    await tx.dealParticipant.createMany({
      data: [
        {
          organizationId: input.organizationId,
          dealId: deal.id,
          userId: input.ownerUserId,
          role: DealParticipantRole.OWNER,
          creditedAt: new Date(),
        },
        {
          organizationId: input.organizationId,
          dealId: deal.id,
          userId: input.ownerUserId,
          role: DealParticipantRole.CLOSER,
          creditShare: 100,
          creditedAt: new Date(),
        },
      ],
      skipDuplicates: true,
    });
  }
  return deal;
}

async function createBookingFromSubmission(
  tx: Tx,
  input: {
    organizationId: string;
    formId: string;
    formName: string;
    formSubmissionId: string;
    businessUnitId: string | null;
    meetingLinkId: string;
    assignedUserId: string | null;
    contactId: string | null;
    companyId: string | null;
    dealId: string | null;
    guestName: string;
    guestEmail: string;
    guestPhone?: string | null;
    startsAt: Date;
    durationMinutes?: number | null;
    holdToken?: string | null;
    idempotencyKey?: string | null;
  },
) {
  const link = await tx.meetingLink.findFirst({
    where: {
      id: input.meetingLinkId,
      organizationId: input.organizationId,
      status: "ACTIVE",
      isActive: true,
    },
  });
  if (!link) return null;
  const hostUserId = input.assignedUserId ?? link.ownerUserId ?? link.userId;
  const duration = input.durationMinutes ?? link.durationMinutes;
  const endsAt = new Date(input.startsAt.getTime() + duration * 60000);
  const hold = await consumeBookingHold(tx, input.holdToken);
  const [bookings, holds] = await Promise.all([
    getBookingBusyRanges(tx, {
      organizationId: input.organizationId,
      hostUserId,
      from: new Date(input.startsAt.getTime() - (link.bufferBeforeMinutes ?? 0) * 60000),
      to: new Date(endsAt.getTime() + (link.bufferAfterMinutes ?? 0) * 60000),
    }),
    getActiveHoldRanges(tx, {
      organizationId: input.organizationId,
      meetingLinkId: link.id,
      hostUserId,
      from: input.startsAt,
      to: endsAt,
      excludeTokenHash: hold?.tokenHash ?? null,
    }),
  ]);
  const range = { startsAt: input.startsAt, endsAt };
  if ([...bookings, ...holds].some((busy) => rangesOverlap(range, busy))) {
    await tx.operationalEvent.create({
      data: {
        organizationId: input.organizationId,
        eventType: OperationalEventType.BOOKING_CONFLICT_PREVENTED,
        formSubmissionId: input.formSubmissionId,
        status: "slot_unavailable",
        metadata: inputJson({
          meetingLinkId: link.id,
          hostUserId,
          startsAt: input.startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
        }),
      },
    });
    throw new BadRequestError("選択した日時は予約できません。別の時間を選択してください。");
  }
  const booking = await tx.meetingBooking.create({
    data: {
      organizationId: input.organizationId,
      meetingLinkId: link.id,
      contactId: input.contactId,
      companyId: input.companyId,
      businessUnitId: input.businessUnitId ?? link.businessUnitId,
      dealId: input.dealId,
      formSubmissionId: input.formSubmissionId,
      bookingHoldId: hold?.id ?? null,
      externalSubmissionId: input.idempotencyKey ?? null,
      hostUserId,
      assignedUserId: input.assignedUserId,
      submittedByContactId: input.contactId,
      creditedAppointmentSetterId:
        link.appointmentCreditPolicy === "NO_IS_CREDIT"
          ? null
          : link.appointmentCreditPolicy === "FIXED_USER"
            ? link.appointmentCreditFixedUserId
            : input.assignedUserId ?? hostUserId,
      guestName: input.guestName,
      guestEmail: input.guestEmail.toLowerCase(),
      guestPhone: input.guestPhone,
      startsAt: input.startsAt,
      endsAt,
      status: "SCHEDULED",
      bookingStatus: link.googleCalendarEnabled
        ? BookingStatus.PENDING_SYNC
        : BookingStatus.CONFIRMED,
      syncStatus: link.googleCalendarEnabled
        ? CalendarSyncStatus.PENDING
        : CalendarSyncStatus.NOT_REQUIRED,
      bookingOrigin: BookingOrigin.PUBLIC_FORM,
      timezone: link.timezone,
      idempotencyKey: input.idempotencyKey
        ? `${input.idempotencyKey}:booking`
        : null,
      sourceChannel: `フォーム: ${input.formName}`,
      legacyMetadata: inputJson({
        formId: input.formId,
        formSubmissionId: input.formSubmissionId,
        titleTemplate: link.titleTemplate,
      }),
    },
  });
  await tx.operationalEvent.create({
    data: {
      organizationId: input.organizationId,
      eventType: OperationalEventType.BOOKING_SUCCEEDED,
      bookingId: booking.id,
      formSubmissionId: input.formSubmissionId,
      status: "created",
      metadata: inputJson({
        meetingLinkId: link.id,
        hostUserId,
        googleCalendarEnabled: link.googleCalendarEnabled,
      }),
    },
  });
  if (booking.creditedAppointmentSetterId) {
    await tx.salesPerformanceEvent.createMany({
      data: [
        {
          organizationId: input.organizationId,
          businessUnitId: booking.businessUnitId,
          dealId: booking.dealId,
          meetingBookingId: booking.id,
          creditedUserId: booking.creditedAppointmentSetterId,
          creditedRole: DealParticipantRole.APPOINTMENT_SETTER,
          workFunction: "IS",
          eventType: SalesPerformanceEventType.APPOINTMENT_SET,
          source: "SYSTEM",
          occurredAt: new Date(),
          quantity: 1,
          idempotencyKey: `public-booking-appointment-set:${booking.id}`,
          metadata: inputJson({
            bookingOrigin: booking.bookingOrigin,
            creditPolicy: link.appointmentCreditPolicy,
          }),
        },
      ],
      skipDuplicates: true,
    });
  }
  return booking;
}

export async function submitPublicForm(input: {
  slug: string;
  body: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const body = publicBody(input.body);
  if (body.honeypot) return { ok: true, suppressed: true };
  const syncTargets: string[] = [];
  const result = await prisma.$transaction(async (tx) => {
    const form = await tx.form.findUnique({ where: { slug: input.slug } });
    if (!form || form.status === "PAUSED" || form.status === "ARCHIVED") {
      throw new BadRequestError("フォームが見つかりません。");
    }
    if (!form.businessUnitId) {
      throw new BadRequestError("このフォームは事業部が未設定です。");
    }
    if (body.idempotencyKey) {
      const existing = await tx.formSubmission.findFirst({
        where: {
          organizationId: form.organizationId,
          idempotencyKey: body.idempotencyKey,
        },
      });
      if (existing) {
        return {
          form,
          submission: existing,
          redirectUrl: form.redirectUrl,
          duplicate: true,
        };
      }
    }
    const version = await currentFormVersion(tx, form);
    const versionFields = Array.isArray(version.fieldSchema)
      ? version.fieldSchema.map((field) => formFieldSchema.parse(field))
      : [];
    validateSubmissionFields(versionFields, body.payload);
    const mapped = mapFormPayload({
      fields: versionFields,
      mappingSchema: version.mappingSchema,
      payload: body.payload,
    });
    if (!mapped.contact.email && !mapped.contact.phone) {
      throw new BadRequestError("メールアドレスまたは電話番号を入力してください。");
    }
    const routingSeed = await executeRouting(tx, {
      organizationId: form.organizationId,
      businessUnitId: form.businessUnitId,
      formId: form.id,
      payload: body.payload,
      company: mapped.company,
      contact: mapped.contact,
      deal: mapped.deal,
      defaultAssignmentMode: form.assignmentMode,
      fixedUserId: form.fixedAssigneeUserId,
      teamId: form.teamId,
      workFunction: form.workFunction,
    });
    const ownerUserId = routingSeed.assignedUserId ?? form.fixedAssigneeUserId ?? null;
    const { item: company, duplicateCandidates: companyCandidates } =
      await matchOrCreateCompany(tx, {
        organizationId: form.organizationId,
        ownerUserId,
        ...mapped.company,
      });
    const { item: contact, duplicateCandidates: contactCandidates } =
      await matchOrCreateContact(tx, {
        organizationId: form.organizationId,
        ownerUserId,
        ...mapped.contact,
        source: `フォーム: ${form.name}`,
      });
    const submission = await tx.formSubmission.create({
      data: {
        organizationId: form.organizationId,
        formId: form.id,
        formVersionId: version.id,
        companyId: company?.id ?? null,
        contactId: contact.id,
        routingRuleId: routingSeed.routingRuleId,
        assignedUserId: ownerUserId,
        idempotencyKey: body.idempotencyKey,
        rawPayload: inputJson(input.body),
        normalizedPayload: inputJson(body.payload),
        duplicateCandidates: inputJson([...companyCandidates, ...contactCandidates]),
        routingResult: inputJson(routingSeed),
        consentSnapshot: inputJson({
          accepted: body.consentAccepted,
          version: form.privacyConsentVersion,
        }),
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        honeypotValue: body.honeypot,
      },
    });
    await tx.operationalEvent.create({
      data: {
        organizationId: form.organizationId,
        eventType: OperationalEventType.FORM_SUBMISSION_SUCCEEDED,
        formSubmissionId: submission.id,
        status: "accepted",
        metadata: inputJson({
          formId: form.id,
          formVersionId: version.id,
        }),
      },
    });
    await tx.routingExecutionLog.updateMany({
      where: { id: routingSeed.routingExecutionLogId },
      data: { formSubmissionId: submission.id },
    });
    const deal = await createDealFromSubmission(tx, {
      organizationId: form.organizationId,
      businessUnitId: routingSeed.businessUnitId ?? form.businessUnitId,
      ownerUserId,
      formName: form.name,
      companyName: company?.name,
      contactName: `${contact.lastName ?? ""} ${contact.firstName ?? ""}`.trim(),
      mappedDeal: mapped.deal,
      productId: form.targetProductId,
      pipelineId: routingSeed.pipelineId ?? form.pipelineId,
      stageId: routingSeed.stageId ?? form.stageId,
    });
    await linkPrimaryRecords(tx, {
      organizationId: form.organizationId,
      companyId: company?.id,
      contactId: contact.id,
      dealId: deal?.id,
    });
    let booking = null;
    const schedulingConfig = asRecord(version.schedulingConfigSnapshot);
    const meetingLinkId =
      routingSeed.meetingLinkId ??
      form.meetingLinkId ??
      (typeof schedulingConfig.meetingLinkId === "string"
        ? schedulingConfig.meetingLinkId
        : null);
    if (meetingLinkId && mapped.booking.startsAt) {
      booking = await createBookingFromSubmission(tx, {
        organizationId: form.organizationId,
        formId: form.id,
        formName: form.name,
        formSubmissionId: submission.id,
        businessUnitId: routingSeed.businessUnitId ?? form.businessUnitId,
        meetingLinkId,
        assignedUserId: ownerUserId,
        contactId: contact.id,
        companyId: company?.id ?? null,
        dealId: deal?.id ?? null,
        guestName:
          `${contact.lastName ?? ""} ${contact.firstName ?? ""}`.trim() ||
          contact.email ||
          "予約者",
        guestEmail: contact.email ?? mapped.contact.email ?? "",
        guestPhone: contact.phone,
        startsAt: mapped.booking.startsAt,
        durationMinutes: mapped.booking.durationMinutes,
        holdToken:
          typeof input.body.holdToken === "string" ? input.body.holdToken : null,
        idempotencyKey: body.idempotencyKey,
      });
      if (booking) syncTargets.push(booking.id);
    }
    await tx.formSubmission.update({
      where: { id: submission.id },
      data: {
        dealId: deal?.id ?? null,
        meetingBookingId: booking?.id ?? null,
      },
    });
    await createRecordActivity(tx, {
      organizationId: form.organizationId,
      actorUserId: null,
      objectType: "CONTACT",
      objectId: contact.id,
      type: "FORM_SUBMITTED",
      title: `フォーム「${form.name}」が送信されました`,
      body: String(body.payload.message ?? ""),
      metadata: inputJson({ formId: form.id, submissionId: submission.id }),
    });
    if (deal) {
      await createRecordActivity(tx, {
        organizationId: form.organizationId,
        actorUserId: null,
        objectType: "DEAL",
        objectId: deal.id,
        type: "FORM_SUBMITTED",
        title: "フォーム送信から商談を作成しました",
        metadata: inputJson({ formId: form.id, submissionId: submission.id }),
      });
    }
    return {
      form,
      submission: { ...submission, dealId: deal?.id ?? null, meetingBookingId: booking?.id ?? null },
      redirectUrl: form.redirectUrl,
      duplicate: false,
    };
  });
  for (const bookingId of syncTargets) {
    await prisma.$transaction((tx) => syncBookingToGoogle(tx, bookingId));
  }
  return {
    ok: true,
    id: result.submission.id,
    redirectUrl: result.redirectUrl,
    duplicate: result.duplicate,
  };
}
