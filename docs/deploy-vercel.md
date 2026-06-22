# Vercel Deployment

Use Vercel for the temporary production validation environment. This CRM is a
dynamic Next.js 15 App Router application with API routes, auth cookies,
Prisma, and PostgreSQL. It should run on the standard Vercel Node.js runtime,
not Cloudflare Pages Edge conversion.

## Project Settings

| Setting | Value |
| --- | --- |
| Framework preset | `Next.js` |
| Build command | `npm run build` |
| Install command | `npm ci` |
| Output directory | leave empty / Vercel default |
| Root directory | `/` |
| Node.js version | `20.x` |

The `build` script runs `node scripts/vercel-build.mjs`, which generates Prisma
Client and then runs `next build`. The Cloudflare `pages:build` script remains
in `package.json`, but do not use it for this Vercel validation.

## Required Environment Variables

Set these in Vercel Project Settings > Environment Variables for Production
and Preview as needed.

```text
DATABASE_URL
MIGRATE_DATABASE_URL
SESSION_SECRET
SESSION_COOKIE_NAME
SESSION_TTL_DAYS
APP_URL
APP_ENCRYPTION_KEY
APP_ENCRYPTION_KEY_VERSION
GOOGLE_CALENDAR_CLIENT_ID
GOOGLE_CALENDAR_CLIENT_SECRET
GOOGLE_CALENDAR_REDIRECT_URI
GOOGLE_CALENDAR_WEBHOOK_URL
GOOGLE_CALENDAR_INTEGRATION_ENABLED
GOOGLE_CALENDAR_WEBHOOK_ENABLED
PUBLIC_SCHEDULING_ENABLED
FORM_BUILDER_V2_ENABLED
LEGACY_EXCEL_IMPORT_ENABLED
LEGACY_PROGRESS_IMPORT_MAX_BYTES
```

Recommended production values:

```text
SESSION_COOKIE_NAME=salesnest_session
SESSION_TTL_DAYS=14
APP_URL=https://<your-vercel-domain>
GOOGLE_CALENDAR_REDIRECT_URI=https://<your-vercel-domain>/api/integrations/google-calendar/callback
GOOGLE_CALENDAR_WEBHOOK_URL=https://<your-vercel-domain>/api/google-calendar/webhook
GOOGLE_CALENDAR_INTEGRATION_ENABLED=true
GOOGLE_CALENDAR_WEBHOOK_ENABLED=false
PUBLIC_SCHEDULING_ENABLED=true
FORM_BUILDER_V2_ENABLED=true
LEGACY_EXCEL_IMPORT_ENABLED=false
LEGACY_PROGRESS_IMPORT_MAX_BYTES=10485760
```

Keep `GOOGLE_CALENDAR_WEBHOOK_ENABLED=false` until the production Vercel URL is
registered and Google watch channel creation is tested. OAuth can be validated
first with only `GOOGLE_CALENDAR_INTEGRATION_ENABLED=true`.

## Database

Use a PostgreSQL database reachable from Vercel, for example Vercel Postgres,
Neon, Supabase, or another managed PostgreSQL provider.

Set `DATABASE_URL` to the pooled/runtime connection string recommended by the
provider. If the provider gives a separate direct migration URL, run migrations
from a trusted local machine or CI with that direct URL.

For Supabase, keep `DATABASE_URL` as the runtime Pooler URL if desired, but set
`MIGRATE_DATABASE_URL` to the Direct connection URL for migration and seed. The
bootstrap build script automatically uses `MIGRATE_DATABASE_URL` when present.

## Migration

After the production `DATABASE_URL` is ready, apply migrations:

```bash
DATABASE_URL="<production-database-url>" npx prisma migrate deploy
```

Do not use `prisma migrate dev` against production.

If Vercel environment variables are marked sensitive and cannot be pulled
locally, run the one-time bootstrap inside Vercel's build environment:

```bash
vercel deploy --prod --force --build-env BOOTSTRAP_DATABASE_ON_BUILD=true
```

`BOOTSTRAP_DATABASE_ON_BUILD=true` runs `prisma migrate deploy` and
`prisma/seed.ts` before the normal build. Do not store this flag permanently in
the Vercel project. Use it only for the initial empty CRM database.

For Supabase, this bootstrap requires `MIGRATE_DATABASE_URL` if `DATABASE_URL`
points at the pooler endpoint. The script intentionally refuses to run
migrations against `pooler.supabase.com` without a direct migration URL.

## Seed

Seed only when creating an initial test environment:

```bash
DATABASE_URL="<production-database-url>" npx tsx prisma/seed.ts
```

The seed creates the sample admin account shown by the script output. Do not
run seed against a real production database after real customer data exists.

## Google Cloud OAuth

In Google Cloud Console > APIs & Services > Credentials > OAuth 2.0 Client,
add this Authorized redirect URI:

```text
https://<your-vercel-domain>/api/integrations/google-calendar/callback
```

If you later move from the default Vercel domain to a custom domain, add the
new custom-domain callback too and update these Vercel variables:

```text
APP_URL
GOOGLE_CALENDAR_REDIRECT_URI
GOOGLE_CALENDAR_WEBHOOK_URL
```

The URI must match exactly, including `https`, host, and path.

## Cloudflare DNS

Cloudflare can remain the DNS provider. Point the production hostname to Vercel
using Vercel's recommended CNAME/A records. Keep Cloudflare Pages deployment
disabled or unused for this CRM until the Edge/OpenNext migration is handled
separately.

## Verification

After deploy:

1. Open `https://<your-vercel-domain>/login`.
2. Sign in with the seeded admin account if seed was run.
3. Confirm `/dashboard`, `/forms`, and `/meetings` load.
4. Connect Google Calendar from `/meetings`.
5. Confirm the OAuth callback returns to the app.
6. Create a meeting link and public booking.
7. Confirm the booking sync status and Google event creation.
8. Test token revoke and reconnect before enabling webhook in production.
