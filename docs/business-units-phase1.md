# Business Units Phase 1 Notes

## Phase 0 findings

- Next.js App Router, React, TypeScript, Prisma, PostgreSQL, Zod, Tailwind CSS.
- Auth is cookie based. `AuthSession` stores the active organization and `getAuthContext()` rechecks `OrganizationMember` status on every request.
- Tenant isolation is organization-first. CRM APIs use `context.organization.id` instead of trusting client-supplied organization IDs.
- Existing reusable objects:
  - Users: `User`, `OrganizationMember`, `Team`
  - Organizations: `Organization`, `Invitation`, `AuthSession`
  - Customer data: `Contact`, `Company`, `ObjectAssociation`
  - Sales: `Deal`, `Pipeline`, `PipelineStage`
  - Activities and tasks: `Activity`, `Task`
  - Capture: `Form`, `FormSubmission`, `Conversation`
  - Scheduling: `AvailabilityRule`, `MeetingLink`, `MeetingBooking`
  - Imports and configuration: `ImportJob`, `SavedView`, `CustomProperty`, `AuditLog`

## Adopted design

- Added `BusinessUnit` as a first-class organization-owned model.
- Added `BusinessUnitMembership` so a user can belong to multiple business units and work functions.
- Kept organization role separate from work function. `SUPER_ADMIN`, `ADMIN`, `MANAGER`, `USER`, `READ_ONLY` remain authorization roles. `IS`, `FS`, `CS` are stored on business unit memberships.
- Added nullable `businessUnitId` to `Pipeline`, `Deal`, and `Form`.
- Added `selectedBusinessUnitId` to `OrganizationMember` so the app can persist the user's current business unit per organization.
- Kept customer master data shared across the organization. Contacts and companies are not duplicated per business unit.

## Rejected alternatives

- Hard-coding 第1事業部 and HD事業部 in application logic was rejected. They are seed data and can be edited in settings.
- Making `businessUnitId` required immediately was rejected. Existing production data may need review before assignment.
- Treating IS / FS / CS as permission roles was rejected because one user can have multiple work functions across multiple business units.

## DB changes

- New enums: `BusinessUnitStatus`, `WorkFunction`.
- New tables: `business_units`, `business_unit_memberships`.
- New columns:
  - `organization_members.selected_business_unit_id`
  - `pipelines.business_unit_id`
  - `deals.business_unit_id`
  - `forms.business_unit_id`
- New indexes were added for business unit filtering and membership lookup.

## Migration

Run:

```bash
npm run db:migrate
npm run db:seed
```

Migration file:

```text
prisma/migrations/20260619043656_business_units/migration.sql
```

The migration is non-destructive. Existing pipeline, deal, and form rows remain valid with `business_unit_id = null` until assigned.

## Seed

Seed creates:

- 第1事業部: IS / FS
- HD事業部: IS / FS / CS
- Initial memberships for `admin@example.com` and `sales@example.com`
- 第1事業部 standard sales pipeline
- HD事業部 sales pipeline
- Sample form and sample deals assigned to 第1事業部

## UI and API changes

- Header now has a business unit selector.
- Dashboard, deals, deal pipeline, forms, and pipeline settings respect the selected business unit.
- Settings now includes business unit management.
- Member settings now manages business unit memberships and IS / FS / CS work functions.
- New APIs:
  - `GET /api/business-units`
  - `POST /api/business-units`
  - `PATCH /api/business-units/:id`
  - `POST /api/business-units/select`
  - `POST /api/business-unit-memberships`

## Phase 2 handoff prompt

Implement Phase 2 KPI foundation on top of the existing Phase 1 business unit model. Add `MetricDefinition`, `DailyMetricEntry`, `KpiTarget`, and contribution attribution without storing KPI counters on users or deals. Keep KPI definitions safe and configurable through allowed source objects, filters, and aggregation operators. Add daily metric input for manual IS/FS/CS metrics, warning-only data quality checks, KPI aggregation services, definition/target management screens, and tests for tenant isolation, business unit access, date ranges, zero division, and attribution.
