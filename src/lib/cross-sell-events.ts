import {
  DealParticipantRole,
  DealStatus,
  Prisma,
  SalesPerformanceEventType,
} from "@prisma/client";

type Tx = Prisma.TransactionClient;

function amount(value: Prisma.Decimal | number | null | undefined) {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : value.toNumber();
}

function inputJson(value: unknown) {
  return value as Prisma.InputJsonValue;
}

function creditShare(value: Prisma.Decimal | number | null | undefined) {
  if (value === null || value === undefined) return 1;
  const numeric = amount(value);
  return numeric > 1 ? numeric / 100 : numeric;
}

export async function syncCrossSellPerformanceEvents(
  tx: Tx,
  input: { organizationId: string; dealId: string; occurredAt?: Date },
) {
  const deal = await tx.deal.findFirst({
    where: {
      id: input.dealId,
      organizationId: input.organizationId,
      dealType: "CROSS_SELL",
      deletedAt: null,
    },
    include: {
      lineItems: true,
      participants: { where: { status: "ACTIVE" } },
    },
  });
  if (!deal) return { created: 0 };
  const occurredAt = input.occurredAt ?? new Date();
  const originators = deal.participants.filter(
    (participant) => participant.role === DealParticipantRole.CROSS_SELL_ORIGINATOR,
  );
  const meetingOwners = deal.participants.filter(
    (participant) => participant.role === DealParticipantRole.MEETING_OWNER,
  );
  const closers = deal.participants.filter(
    (participant) => participant.role === DealParticipantRole.CLOSER,
  );
  const fallbackOwner = deal.ownerUserId
    ? [{ userId: deal.ownerUserId, creditShare: null }]
    : [];
  const grossProfit = deal.lineItems.reduce(
    (sum, line) =>
      sum +
      amount(line.grossProfitAmount) +
      (line.grossProfitAmount ? 0 : amount(line.expectedGrossProfitAmount)),
    0,
  );
  const meetingBookings = await tx.meetingBooking.findMany({
    where: { organizationId: input.organizationId, dealId: deal.id },
    select: { id: true, attendedAt: true, status: true },
  });

  const rows: Prisma.SalesPerformanceEventCreateManyInput[] = [];
  for (const participant of originators.length ? originators : fallbackOwner) {
    if (!participant.userId) continue;
    rows.push({
      organizationId: input.organizationId,
      businessUnitId: deal.businessUnitId,
      dealId: deal.id,
      creditedUserId: participant.userId,
      creditedRole: DealParticipantRole.CROSS_SELL_ORIGINATOR,
      workFunction: "CS",
      eventType: SalesPerformanceEventType.CROSS_SELL_CREATED,
      source: "SYSTEM",
      occurredAt: deal.createdAt,
      quantity: 1,
      idempotencyKey: `cross-sell-created:${deal.id}:${participant.userId}`,
      metadata: inputJson({ originProjectId: deal.originProjectId }),
    });
    if (deal.status === DealStatus.WON && grossProfit > 0) {
      rows.push({
        organizationId: input.organizationId,
        businessUnitId: deal.businessUnitId,
        dealId: deal.id,
        creditedUserId: participant.userId,
        creditedRole: DealParticipantRole.CROSS_SELL_ORIGINATOR,
        workFunction: "CS",
        eventType: SalesPerformanceEventType.CROSS_SELL_ORIGINATED_GP,
        source: "SYSTEM",
        occurredAt: deal.wonAt ?? deal.closeDate ?? occurredAt,
        quantity: 1,
        amount: grossProfit,
        idempotencyKey: `cross-sell-originated-gp:${deal.id}:${participant.userId}`,
        metadata: inputJson({
          evaluationOnly: true,
          totalGrossProfitSource: "deal_line_items",
        }),
      });
    }
  }

  for (const participant of meetingOwners) {
    if (!participant.userId) continue;
    rows.push({
      organizationId: input.organizationId,
      businessUnitId: deal.businessUnitId,
      dealId: deal.id,
      creditedUserId: participant.userId,
      creditedRole: DealParticipantRole.MEETING_OWNER,
      workFunction: participant.workFunction ?? "FS",
      eventType: SalesPerformanceEventType.CROSS_SELL_MEETING_SET,
      source: "SYSTEM",
      occurredAt: participant.creditedAt ?? occurredAt,
      quantity: 1,
      idempotencyKey: `cross-sell-meeting-set:${deal.id}:${participant.userId}`,
      metadata: inputJson({ originProjectId: deal.originProjectId }),
    });
  }

  for (const booking of meetingBookings.filter((item) => item.attendedAt || item.status === "ATTENDED")) {
    for (const participant of meetingOwners.length ? meetingOwners : closers) {
      if (!participant.userId) continue;
      rows.push({
        organizationId: input.organizationId,
        businessUnitId: deal.businessUnitId,
        dealId: deal.id,
        meetingBookingId: booking.id,
        creditedUserId: participant.userId,
        creditedRole: participant.role,
        workFunction: participant.workFunction ?? "FS",
        eventType: SalesPerformanceEventType.CROSS_SELL_MEETING_ATTENDED,
        source: "SYSTEM",
        occurredAt: booking.attendedAt ?? occurredAt,
        quantity: 1,
        idempotencyKey: `cross-sell-meeting-attended:${deal.id}:${booking.id}:${participant.userId}`,
        metadata: inputJson({ originProjectId: deal.originProjectId }),
      });
    }
  }

  if (deal.status === DealStatus.WON) {
    const creditedClosers = closers.length ? closers : fallbackOwner;
    for (const participant of creditedClosers) {
      if (!participant.userId) continue;
      const share = creditShare(participant.creditShare);
      rows.push({
        organizationId: input.organizationId,
        businessUnitId: deal.businessUnitId,
        dealId: deal.id,
        creditedUserId: participant.userId,
        creditedRole: DealParticipantRole.CLOSER,
        workFunction:
          "workFunction" in participant
            ? (participant.workFunction ?? "FS")
            : "FS",
        eventType: SalesPerformanceEventType.CROSS_SELL_WON,
        source: "SYSTEM",
        occurredAt: deal.wonAt ?? deal.closeDate ?? occurredAt,
        quantity: 1,
        amount: grossProfit > 0 ? grossProfit * share : null,
        idempotencyKey: `cross-sell-won:${deal.id}:${participant.userId}`,
        metadata: inputJson({
          creditShare: share,
          totalGrossProfitSource: "deal_line_items",
          evaluationAmount: grossProfit > 0,
        }),
      });
    }
  }

  if (deal.status === DealStatus.CANCELLED || deal.status === DealStatus.LOST) {
    const eventType =
      deal.status === DealStatus.CANCELLED
        ? SalesPerformanceEventType.CROSS_SELL_CANCELLED
        : SalesPerformanceEventType.CROSS_SELL_LOST;
    for (const participant of [...originators, ...meetingOwners, ...closers]) {
      if (!participant.userId) continue;
      rows.push({
        organizationId: input.organizationId,
        businessUnitId: deal.businessUnitId,
        dealId: deal.id,
        creditedUserId: participant.userId,
        creditedRole: participant.role,
        workFunction: participant.workFunction,
        eventType,
        source: "SYSTEM",
        occurredAt:
          deal.status === DealStatus.CANCELLED
            ? deal.cancelledAt ?? occurredAt
            : deal.lostAt ?? occurredAt,
        quantity: 1,
        idempotencyKey: `cross-sell-${deal.status.toLowerCase()}:${deal.id}:${participant.userId}:${participant.role}`,
        metadata: inputJson({ originProjectId: deal.originProjectId }),
      });
    }
  }

  if (!rows.length) return { created: 0 };
  const result = await tx.salesPerformanceEvent.createMany({
    data: rows,
    skipDuplicates: true,
  });
  return { created: result.count };
}
