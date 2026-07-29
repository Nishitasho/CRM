import { z } from "zod";

export const legacyExcelApplyRequestSchema = z.object({
  importJobId: z.string().uuid(),
  resume: z.boolean().optional(),
  confirmed: z.boolean().optional(),
  confirmText: z.string().optional(),
  applyTargets: z
    .object({
      masters: z.boolean().optional(),
      companiesContacts: z.boolean().optional(),
      deals: z.boolean().optional(),
      dealLineItems: z.boolean().optional(),
      deliveryProjects: z.boolean().optional(),
      autoDeliveryProjects: z.boolean().optional(),
      reviewDeliveryProjects: z.boolean().optional(),
      unresolvedDeliveryProjects: z.boolean().optional(),
      activities: z.boolean().optional(),
      dailyMetrics: z.boolean().optional(),
      kpiTargets: z.boolean().optional(),
    })
    .optional(),
  unresolvedDeliveryProjectConfirmText: z.string().optional(),
  manualMatches: z
    .record(
      z.object({
        progressCandidateId: z.string().optional(),
        decision: z.enum(["MANUAL", "UNRESOLVED", "IGNORE"]).optional(),
      }),
    )
    .optional(),
});

export type LegacyExcelApplyRequest = z.infer<
  typeof legacyExcelApplyRequestSchema
>;

export function parseLegacyExcelApplyRequest(value: unknown) {
  return legacyExcelApplyRequestSchema.parse(value);
}
