# Google Calendar Production Checklist

## Google Cloud

- Enable Google Calendar API.
- Configure OAuth consent screen with production application name, support email, authorized domain, privacy policy, and terms of service.
- Register the production redirect URI exactly:
  - `https://<production-domain>/api/integrations/google-calendar/callback`
- Register the webhook URL:
  - `https://<production-domain>/api/google-calendar/webhook`
- Confirm publishing status and whether OAuth verification is required for the selected scopes.
- Use only these scopes for Phase 3-E:
  - `https://www.googleapis.com/auth/calendar.events.owned`
  - `https://www.googleapis.com/auth/calendar.freebusy`
  - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
- Confirm Google Calendar API quota for expected form submissions, booking sync, full sync, incremental sync, and watch renewals.

## Environment Variables

```bash
GOOGLE_CALENDAR_INTEGRATION_ENABLED=true
GOOGLE_CALENDAR_WEBHOOK_ENABLED=true
PUBLIC_SCHEDULING_ENABLED=true
FORM_BUILDER_V2_ENABLED=true
GOOGLE_CALENDAR_CLIENT_ID=...
GOOGLE_CALENDAR_CLIENT_SECRET=...
GOOGLE_CALENDAR_REDIRECT_URI=https://<production-domain>/api/integrations/google-calendar/callback
GOOGLE_CALENDAR_WEBHOOK_URL=https://<production-domain>/api/google-calendar/webhook
APP_ENCRYPTION_KEY=...
APP_ENCRYPTION_KEY_VERSION=v1
APP_URL=https://<production-domain>
```

Keep Google Calendar flags `false` until real OAuth, booking creation, external change detection, and revoke/reauth testing pass.

## OAuth Operations

- OAuth uses `access_type=offline` and `include_granted_scopes=true`.
- OAuth state is stored hashed, expires after 10 minutes, and is consumed after callback.
- Existing refresh tokens are not overwritten when Google omits a new refresh token.
- Disconnect attempts Google token revoke, then removes encrypted CRM tokens.
- When refresh fails, the connection is marked `REAUTH_REQUIRED`.
- Do not log access tokens, refresh tokens, authorization codes, Google response bodies, full form payloads, full email addresses, or phone numbers.

## Calendar Selection

- Because the write scope is `calendar.events.owned`, only calendars with `accessRole=owner` are selectable as write targets.
- Non-owner calendars may be used only for busy checks where Google permits it.
- Shared-calendar write support is intentionally out of Phase 3-E scope.

## Sync And Webhook Recovery

- CRM booking IDs generate deterministic Google event IDs.
- Event private extended properties include only `crmBookingId`, `organizationId`, `environment`, and `integrationVersion`.
- First sync runs `events.list` without `syncToken` and stores `nextSyncToken`.
- Incremental sync uses the stored `syncToken`.
- Google `410` invalidates the token and triggers a full sync.
- Webhook requests verify channel ID, resource ID, channel token with constant-time comparison, active status, expiry, and message number idempotency.
- Webhook only queues/starts calendar sync; it must not mark every booking changed.
- Watch channels should be renewed before expiry. Manual renewal is available from the meetings integration API.

## Booking Collision Responsibility

- The database exclusion constraint protects active bookings.
- Buffer-before and buffer-after logic is enforced in the application layer before hold creation and booking creation.
- Active holds are serialized with a PostgreSQL advisory transaction lock per organization, meeting link, and host.
- Cancelled, expired, no-show, and inactive records are not treated as active booking conflicts.

## Encryption Key Rotation

- Tokens use AES-256-GCM with a random IV and authentication tag per encryption.
- New tokens store `APP_ENCRYPTION_KEY_VERSION` in the encrypted envelope and on `GoogleCalendarConnection`.
- To rotate keys safely:
  1. Add a new key version to secret management.
  2. Deploy code that can read old and new versions.
  3. Re-encrypt tokens connection by connection after successful decrypt.
  4. Update `APP_ENCRYPTION_KEY_VERSION`.
  5. Keep the old key available until all existing tokens are re-encrypted.
- Never reuse production encryption keys in development.

## Production Go/No-Go

Production release should remain blocked until these real-account tests pass:

- Personal Google account OAuth.
- Google Workspace account OAuth.
- Primary calendar write.
- Owner secondary calendar write.
- Non-owner shared calendar is not selectable as write target.
- Access-token refresh.
- Token revoke and reauth path.
- Booking create, reschedule, cancel.
- Duplicate submit and retry do not duplicate Google events.
- Full sync, incremental sync, `410` recovery.
- External Google date change and deletion become `REVIEW_REQUIRED`.
- Watch channel renewal and duplicate webhook idempotency.
