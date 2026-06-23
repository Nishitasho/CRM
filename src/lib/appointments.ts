import {
  BookingOrigin,
  BookingStatus,
  CalendarSyncStatus,
  DealParticipantRole,
  Prisma,
  SalesPerformanceEventSource,
  SalesPerformanceEventType,
} from "@prisma/client";
import { z } from "zod";
import { BadRequestError } from "./api";
import { AuthContext } from "./auth";
import { assertBusinessUnitAccess } from "./business-units";
import { createRecordActivity } from "./crm";
import { syncBookingToGoogle } from "./google-calendar";
import { canAdministrateInternalAppointments } from "./internal-appointments";
import { AuthorizationError } from "./permissions";
import { prisma } from "./prisma";
import { assignUser } from "./routing";
import { appointmentCreateSchema } from "./validation";

type AppointmentInput = z.infer<typeof appointmentCreateSchema>;

function inputJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function clean(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizePhone(value: string | null | undefined) {
  return clean(value)?.replace(/[^\d+]/g, "") ?? null;
}

function domainFromUrl(value: string | null | undefined) {
  const text = clean(value);
  if (!text) return null;
  try {
    return new URL(text).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function firstAndLastName(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length >= 2) {
    return { lastName: parts[0], firstName: parts.slice(1).join(" ") };
  }
  return { lastName: fullName.trim(), firstName: null };
}

function appointmentFields() {
  const required = [
    "businessUnitId",
    "appointmentSetterUserId",
    "companyName",
    "prefectureCode",
    "industryId",
    "primaryProductId",
    "appointmentAcquiredAt",
    "scheduledStartAt",
    "scheduledEndAt",
    "assignmentMode",
    "decisionMakerStatus",
    "sourceChannel",
  ];
  return required.map((name, index) => ({
    name,
    label: name,
    type: name.endsWith("At") ? "datetime" : "text",
    required: true,
    systemRequired: true,
    sortOrder: index,
  }));
}

async function ensureInternalAppointmentForm(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    businessUnitId: string;
    userId: string;
  },
) {
  const slug = `internal-appointment-${input.organizationId.slice(0, 8)}-${input.businessUnitId.slice(0, 8)}`;
  const form = await tx.form.upsert({
    where: { slug },
    create: {
      organizationId: input.organizationId,
      businessUnitId: input.businessUnitId,
      name: "ISアポ登録",
      slug,
      status: "PUBLISHED",
      formPurpose: "INTERNAL_APPOINTMENT",
      isInternal: true,
      isDefaultForBusinessUnit: true,
      fields: inputJson(appointmentFields()),
      mappingSchema: {},
      routingConfig: {},
      schedulingConfig: {},
      submitButtonText: "アポを登録",
      completionMessage: "アポを登録しました。",
    },
    update: {
      businessUnitId: input.businessUnitId,
      status: "PUBLISHED",
      formPurpose: "INTERNAL_APPOINTMENT",
      isInternal: true,
      isDefaultForBusinessUnit: true,
    },
  });
  if (form.publishedVersionId) return { form, formVersionId: form.publishedVersionId };
  const latest = await tx.formVersion.aggregate({
    where: { formId: form.id },
    _max: { version: true },
  });
  const version = await tx.formVersion.create({
    data: {
      organizationId: input.organizationId,
      businessUnitId: input.businessUnitId,
      formId: form.id,
      version: (latest._max.version ?? 0) + 1,
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
  await tx.form.update({
    where: { id: form.id },
    data: { publishedVersionId: version.id },
  });
  return { form, formVersionId: version.id };
}

async function pipelineForAppointment(
  tx: Prisma.TransactionClient,
  organizationId: string,
  businessUnitId: string,
) {
  const pipeline = await tx.pipeline.findFirst({
    where: {
      organizationId,
      OR: [{ businessUnitId }, { businessUnitId: null }],
    },
    include: { stages: { orderBy: { sortOrder: "asc" } } },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  const stage =
    pipeline?.stages.find((item) => item.name.includes("商談予定")) ??
    pipeline?.stages.find((item) => item.name.includes("アポ")) ??
    pipeline?.stages[0];
  if (!pipeline || !stage) {
    throw new BadRequestError("商談を作成するパイプラインがありません。");
  }
  return { pipeline, stage };
}

async function ensureInternalMeetingLink(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    businessUnitId: string;
    hostUserId: string;
    durationMinutes: number;
    googleCalendarEnabled: boolean;
  },
) {
  const slug = `internal-fs-${input.organizationId.slice(0, 8)}-${input.hostUserId.slice(0, 8)}`;
  return tx.meetingLink.upsert({
    where: { slug },
    create: {
      organizationId: input.organizationId,
      businessUnitId: input.businessUnitId,
      userId: input.hostUserId,
      ownerUserId: input.hostUserId,
      name: "内部アポ登録",
      slug,
      assignmentMode: "FIXED_USER",
      workFunction: "FS",
      durationMinutes: input.durationMinutes,
      googleCalendarEnabled: input.googleCalendarEnabled,
      minimumNoticeMinutes: 0,
      appointmentCreditPolicy: "FORM_OWNER",
      googleFallbackMode: "crm_only",
    },
    update: {
      businessUnitId: input.businessUnitId,
      userId: input.hostUserId,
      ownerUserId: input.hostUserId,
      durationMinutes: input.durationMinutes,
      googleCalendarEnabled: input.googleCalendarEnabled,
      status: "ACTIVE",
      isActive: true,
    },
  });
}

async function resolveFsUser(
  tx: Prisma.TransactionClient,
  organizationId: string,
  input: AppointmentInput,
) {
  if (input.assignedFsUserId) return input.assignedFsUserId;
  if (input.assignmentMode === "MANUAL") return null;
  const assignment = await assignUser(tx, {
    organizationId,
    businessUnitId: input.businessUnitId,
    assignmentMode: input.assignmentMode,
    fixedUserId: input.assignedFsUserId ?? null,
    workFunction: "FS",
    requireGoogleConnection: Boolean(input.googleCalendarEnabled),
    scopeSuffix: "internal-appointment",
  });
  return assignment.selectedUserId;
}

async function hasActiveBusinessUnitMembership(input: {
  organizationId: string;
  businessUnitId: string;
  userId: string;
  workFunction: "IS" | "FS";
}) {
  const membership = await prisma.businessUnitMembership.findFirst({
    where: {
      organizationId: input.organizationId,
      businessUnitId: input.businessUnitId,
      userId: input.userId,
      workFunction: input.workFunction,
      status: "ACTIVE",
      businessUnit: { status: "ACTIVE" },
      user: {
        memberships: {
          some: { organizationId: input.organizationId, status: "ACTIVE" },
        },
      },
    },
    select: { id: true },
  });
  return Boolean(membership);
}

async function findOrCreateCompany(
  tx: Prisma.TransactionClient,
  organizationId: string,
  ownerUserId: string | null,
  input: AppointmentInput,
) {
  if (input.companyId) {
    const company = await tx.company.findFirst({
      where: { id: input.companyId, organizationId, deletedAt: null },
    });
    if (company) return company;
  }
  const phone = normalizePhone(input.phone);
  const domain = domainFromUrl(input.websiteUrl);
  const address = [input.address, input.city, input.prefectureName].filter(Boolean).join(" ");
  const existing = await tx.company.findFirst({
    where: {
      organizationId,
      deletedAt: null,
      OR: [
        ...(phone ? [{ phone }] : []),
        ...(domain ? [{ domain }] : []),
        {
          name: input.companyName,
          city: input.city ?? undefined,
          prefecture: input.prefectureName,
          address: input.address ?? undefined,
        },
      ],
    },
    orderBy: { updatedAt: "desc" },
  });
  const data = {
    ownerUserId,
    name: input.companyName,
    domain,
    phone,
    industry: input.industryId,
    address: input.address ?? (address || null),
    city: input.city,
    prefecture: input.prefectureName,
    postalCode: input.postalCode,
    websiteUrl: input.websiteUrl,
    customFields: inputJson({
      storeName: input.storeName,
      prefectureCode: input.prefectureCode,
      industryId: input.industryId,
      territoryId: input.territoryId,
      businessType: input.businessType,
      storeCount: input.storeCount,
      customerStatus: input.customerStatus,
    }),
  };
  return existing
    ? tx.company.update({ where: { id: existing.id }, data })
    : tx.company.create({ data: { organizationId, ...data } });
}

async function findOrCreateContact(
  tx: Prisma.TransactionClient,
  organizationId: string,
  ownerUserId: string | null,
  companyId: string,
  input: AppointmentInput,
) {
  if (input.contactId) {
    const contact = await tx.contact.findFirst({
      where: { id: input.contactId, organizationId, deletedAt: null },
    });
    if (contact) return contact;
  }
  const email = input.email?.toLowerCase() ?? null;
  const mobilePhone = normalizePhone(input.mobilePhone);
  const names = firstAndLastName(input.contactName);
  const existing = await tx.contact.findFirst({
    where: {
      organizationId,
      deletedAt: null,
      OR: [
        ...(email ? [{ email }] : []),
        ...(mobilePhone ? [{ mobilePhone }] : []),
        {
          firstName: names.firstName,
          lastName: names.lastName,
        },
      ],
    },
    orderBy: { updatedAt: "desc" },
  });
  const data = {
    ownerUserId,
    firstName: names.firstName,
    lastName: names.lastName,
    email,
    mobilePhone,
    jobTitle: input.jobTitle,
    source: input.sourceChannel,
    memo: input.communicationNotes,
    customFields: inputJson({
      companyId,
      kana: input.contactKana,
      decisionMakerStatus: input.decisionMakerStatus,
      preferredContactMethod: input.preferredContactMethod,
    }),
  };
  return existing
    ? tx.contact.update({ where: { id: existing.id }, data })
    : tx.contact.create({ data: { organizationId, ...data } });
}

export async function createInternalAppointment(
  context: AuthContext,
  rawInput: unknown,
) {
  const input = appointmentCreateSchema.parse(rawInput);
  if (!(await assertBusinessUnitAccess(context, input.businessUnitId))) {
    throw new BadRequestError("事業部が見つかりません。");
  }
  const canAdminister = canAdministrateInternalAppointments(context);
  const appointmentSetterUserId =
    input.appointmentSetterUserId ?? context.user.id;
  if (!canAdminister && appointmentSetterUserId !== context.user.id) {
    throw new AuthorizationError("他のIS担当者としてアポ登録する権限がありません。");
  }
  if (
    !(await hasActiveBusinessUnitMembership({
      organizationId: context.organization.id,
      businessUnitId: input.businessUnitId,
      userId: appointmentSetterUserId,
      workFunction: "IS",
    }))
  ) {
    throw new AuthorizationError("選択事業部のACTIVEなIS担当者を選択してください。");
  }
  if (
    input.assignedFsUserId &&
    !(await hasActiveBusinessUnitMembership({
      organizationId: context.organization.id,
      businessUnitId: input.businessUnitId,
      userId: input.assignedFsUserId,
      workFunction: "FS",
    }))
  ) {
    throw new AuthorizationError("選択事業部のACTIVEなFS担当者を選択してください。");
  }
  const loadSubmission = () =>
    prisma.formSubmission.findFirst({
      where: {
        organizationId: context.organization.id,
        idempotencyKey: input.idempotencyKey,
      },
    });
  const existingSubmission = await loadSubmission();
  if (existingSubmission) {
    return {
      duplicated: true,
      formSubmissionId: existingSubmission.id,
      companyId: existingSubmission.companyId,
      contactId: existingSubmission.contactId,
      dealId: existingSubmission.dealId,
      meetingBookingId: existingSubmission.meetingBookingId,
    };
  }

  let syncLater: { bookingId: string; enabled: boolean };
  try {
    syncLater = await prisma.$transaction(async (tx) => {
      const assignedFsUserId = await resolveFsUser(
        tx,
        context.organization.id,
        input,
      );
      const { form, formVersionId } = await ensureInternalAppointmentForm(tx, {
        organizationId: context.organization.id,
        businessUnitId: input.businessUnitId,
        userId: context.user.id,
      });
      const { pipeline, stage } = await pipelineForAppointment(
        tx,
        context.organization.id,
        input.businessUnitId,
      );
      const company = await findOrCreateCompany(
        tx,
        context.organization.id,
        assignedFsUserId ?? appointmentSetterUserId,
        input,
      );
      const contact = await findOrCreateContact(
        tx,
        context.organization.id,
        assignedFsUserId ?? appointmentSetterUserId,
        company.id,
        input,
      );
      const deal = await tx.deal.create({
        data: {
          organizationId: context.organization.id,
          businessUnitId: input.businessUnitId,
          ownerUserId: assignedFsUserId,
          pipelineId: pipeline.id,
          stageId: stage.id,
          name: `${input.storeName ?? input.companyName} / ${input.contactName}`,
          status: "OPEN",
          decisionMakerStatus: input.decisionMakerStatus,
          qualificationResult: input.qualificationResult,
          source: input.sourceChannel,
          externalId: `internal-appointment:${input.idempotencyKey}`,
          nextAction: "初回商談",
          nextActionDate: input.scheduledStartAt,
          customFields: inputJson({
            appointmentAcquiredAt: input.appointmentAcquiredAt,
            scheduledStartAt: input.scheduledStartAt,
            scheduledEndAt: input.scheduledEndAt,
            meetingFormat: input.meetingFormat,
            sourceChannel: input.sourceChannel,
            territoryId: input.territoryId,
            prefectureCode: input.prefectureCode,
            city: input.city,
            industryId: input.industryId,
            productId: input.primaryProductId,
            campaignId: input.campaignId,
            callListId: input.callListId,
            appointmentQuality: {
              issueConfirmed: input.issueConfirmed,
              decisionMakerConfirmed: input.decisionMakerConfirmed,
              needsConfirmed: input.needsConfirmed,
              timingConfirmed: input.timingConfirmed,
              budgetConfirmed: input.budgetConfirmed,
              temperature: input.temperature,
              conditionNgRisk: input.conditionNgRisk,
              concern: input.concern,
            },
          }),
        },
      });
      await tx.objectAssociation.createMany({
        data: [
          {
            organizationId: context.organization.id,
            sourceObjectType: "COMPANY",
            sourceObjectId: company.id,
            targetObjectType: "CONTACT",
            targetObjectId: contact.id,
            label: "担当者",
            isPrimary: true,
          },
          {
            organizationId: context.organization.id,
            sourceObjectType: "COMPANY",
            sourceObjectId: company.id,
            targetObjectType: "DEAL",
            targetObjectId: deal.id,
            label: "商談会社",
            isPrimary: true,
          },
          {
            organizationId: context.organization.id,
            sourceObjectType: "CONTACT",
            sourceObjectId: contact.id,
            targetObjectType: "DEAL",
            targetObjectId: deal.id,
            label: "商談担当者",
            isPrimary: true,
          },
        ],
        skipDuplicates: true,
      });
      const productIds = [
        input.primaryProductId,
        ...input.additionalProductIds.filter((id) => id !== input.primaryProductId),
      ];
      const products = await tx.product.findMany({
        where: { organizationId: context.organization.id, id: { in: productIds } },
      });
      await tx.dealLineItem.createMany({
        data: productIds.map((productId, index) => {
          const product = products.find((item) => item.id === productId);
          return {
            organizationId: context.organization.id,
            businessUnitId: input.businessUnitId,
            dealId: deal.id,
            productId,
            name: product?.name ?? (index === 0 ? "主商材" : "追加商材"),
            quantity: 1,
            status: "PROPOSED",
            source: "INTERNAL_APPOINTMENT",
            metadata: inputJson({ primary: index === 0 }),
          };
        }),
      });
      await tx.dealParticipant.createMany({
        data: [
          {
            organizationId: context.organization.id,
            dealId: deal.id,
            userId: appointmentSetterUserId,
            workFunction: "IS",
            role: DealParticipantRole.APPOINTMENT_SETTER,
            creditedAt: input.appointmentAcquiredAt,
            metadata: inputJson({ sourceChannel: input.sourceChannel }),
          },
          ...(assignedFsUserId
            ? [
                {
                  organizationId: context.organization.id,
                  dealId: deal.id,
                  userId: assignedFsUserId,
                  workFunction: "FS" as const,
                  role: DealParticipantRole.MEETING_OWNER,
                  creditedAt: input.scheduledStartAt,
                  metadata: inputJson({ assignmentMode: input.assignmentMode }),
                },
              ]
            : []),
        ],
      });
      const durationMinutes = Math.max(
        15,
        Math.round((input.scheduledEndAt.getTime() - input.scheduledStartAt.getTime()) / 60000),
      );
      const meetingLink = await ensureInternalMeetingLink(tx, {
        organizationId: context.organization.id,
        businessUnitId: input.businessUnitId,
        hostUserId: assignedFsUserId ?? appointmentSetterUserId,
        durationMinutes,
        googleCalendarEnabled: Boolean(input.googleCalendarEnabled && assignedFsUserId),
      });
      const submission = await tx.formSubmission.create({
        data: {
          organizationId: context.organization.id,
          formId: form.id,
          formVersionId,
          companyId: company.id,
          contactId: contact.id,
          dealId: deal.id,
          assignedUserId: assignedFsUserId,
          idempotencyKey: input.idempotencyKey,
          rawPayload: inputJson(input),
          normalizedPayload: inputJson(input),
          routingResult: inputJson({
            assignmentMode: input.assignmentMode,
            assignedFsUserId,
          }),
        },
      });
      const booking = await tx.meetingBooking.create({
        data: {
          organizationId: context.organization.id,
          meetingLinkId: meetingLink.id,
          contactId: contact.id,
          companyId: company.id,
          businessUnitId: input.businessUnitId,
          dealId: deal.id,
          formSubmissionId: submission.id,
          setByUserId: appointmentSetterUserId,
          hostUserId: assignedFsUserId,
          assignedUserId: assignedFsUserId,
          creditedAppointmentSetterId: appointmentSetterUserId,
          guestName: input.contactName,
          guestEmail: input.email ?? `${contact.id}@no-email.local`,
          guestPhone: input.mobilePhone ?? input.phone,
          startsAt: input.scheduledStartAt,
          endsAt: input.scheduledEndAt,
          status: "SCHEDULED",
          bookingStatus: input.googleCalendarEnabled && assignedFsUserId
            ? BookingStatus.PENDING_SYNC
            : BookingStatus.CONFIRMED,
          syncStatus: input.googleCalendarEnabled && assignedFsUserId
            ? CalendarSyncStatus.PENDING
            : CalendarSyncStatus.NOT_REQUIRED,
          qualificationResult: input.qualificationResult,
          appointmentSetAt: input.appointmentAcquiredAt,
          sourceChannel: input.sourceChannel,
          territoryId: input.territoryId,
          prefectureCode: input.prefectureCode,
          city: input.city,
          industryId: input.industryId,
          productId: input.primaryProductId,
          campaignId: input.campaignId,
          callListId: input.callListId,
          meetingType: input.meetingFormat,
          idempotencyKey: input.idempotencyKey,
          externalSubmissionId: input.idempotencyKey,
          bookingOrigin: BookingOrigin.INTERNAL,
          legacyMetadata: inputJson({
            storeName: input.storeName,
            meetingPurpose: input.meetingPurpose,
            handoff: {
              ownerReaction: input.ownerReaction,
              appointmentBackground: input.appointmentBackground,
              currentIssue: input.currentIssue,
              interestedProductsNote: input.interestedProductsNote,
              concern: input.concern,
              toldCustomer: input.toldCustomer,
              fsRequest: input.fsRequest,
              promises: input.promises,
              handoffNotes: input.handoffNotes,
            },
          }),
        },
      });
      await tx.formSubmission.update({
        where: { id: submission.id },
        data: { meetingBookingId: booking.id },
      });
      if (assignedFsUserId) {
        const task = await tx.task.create({
          data: {
            organizationId: context.organization.id,
            ownerUserId: assignedFsUserId,
            createdByUserId: context.user.id,
            title: `初回商談: ${input.storeName ?? input.companyName}`,
            description: input.handoffNotes ?? input.appointmentBackground,
            dueDate: input.scheduledStartAt,
            priority: input.temperature === "HIGH" ? "HIGH" : "MEDIUM",
            taskType: "MEETING",
          },
          select: { id: true },
        });
        await tx.objectAssociation.createMany({
          data: [
            {
              organizationId: context.organization.id,
              sourceObjectType: "TASK",
              sourceObjectId: task.id,
              targetObjectType: "COMPANY",
              targetObjectId: company.id,
            },
            {
              organizationId: context.organization.id,
              sourceObjectType: "TASK",
              sourceObjectId: task.id,
              targetObjectType: "CONTACT",
              targetObjectId: contact.id,
            },
            {
              organizationId: context.organization.id,
              sourceObjectType: "TASK",
              sourceObjectId: task.id,
              targetObjectType: "DEAL",
              targetObjectId: deal.id,
            },
          ],
          skipDuplicates: true,
        });
      }
      await tx.salesPerformanceEvent.create({
        data: {
          organizationId: context.organization.id,
          businessUnitId: input.businessUnitId,
          dealId: deal.id,
          meetingBookingId: booking.id,
          creditedUserId: appointmentSetterUserId,
          creditedRole: DealParticipantRole.APPOINTMENT_SETTER,
          workFunction: "IS",
          eventType: SalesPerformanceEventType.APPOINTMENT_SET,
          source: SalesPerformanceEventSource.SYSTEM,
          occurredAt: input.appointmentAcquiredAt,
          quantity: 1,
          territoryId: input.territoryId,
          prefectureCode: input.prefectureCode,
          city: input.city,
          industryId: input.industryId,
          productId: input.primaryProductId,
          campaignId: input.campaignId,
          callListId: input.callListId,
          idempotencyKey: `internal-appointment-set:${input.idempotencyKey}`,
          metadata: inputJson({ sourceChannel: input.sourceChannel }),
        },
      });
      await createRecordActivity(tx, {
        organizationId: context.organization.id,
        actorUserId: context.user.id,
        objectType: "DEAL",
        objectId: deal.id,
        type: "MEETING",
        title: "ISアポ登録から商談予定を作成しました",
        body: input.appointmentBackground ?? input.handoffNotes,
        metadata: inputJson({
          bookingId: booking.id,
          formSubmissionId: submission.id,
          assignedFsUserId,
          submittedByUserId: context.user.id,
          creditedAppointmentSetterUserId: appointmentSetterUserId,
          businessUnitId: input.businessUnitId,
        }),
        occurredAt: input.appointmentAcquiredAt,
      });
      return { bookingId: booking.id, enabled: Boolean(input.googleCalendarEnabled && assignedFsUserId) };
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const duplicated = await loadSubmission();
      if (duplicated) {
        return {
          duplicated: true,
          formSubmissionId: duplicated.id,
          companyId: duplicated.companyId,
          contactId: duplicated.contactId,
          dealId: duplicated.dealId,
          meetingBookingId: duplicated.meetingBookingId,
        };
      }
    }
    throw error;
  }
  if (syncLater.enabled) {
    await prisma.$transaction((tx) => syncBookingToGoogle(tx, syncLater.bookingId));
  }
  const submission = await prisma.formSubmission.findFirstOrThrow({
    where: {
      organizationId: context.organization.id,
      idempotencyKey: input.idempotencyKey,
    },
  });
  return {
    duplicated: false,
    formSubmissionId: submission.id,
    companyId: submission.companyId,
    contactId: submission.contactId,
    dealId: submission.dealId,
    meetingBookingId: submission.meetingBookingId,
  };
}
