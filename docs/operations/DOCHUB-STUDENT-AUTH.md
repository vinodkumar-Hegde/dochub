# DocHub student authentication — operations and security handoff

## Decision and scope

The **student** identity mechanism is normal email/password, not Cognito: server-side
scrypt password hashes, one-time email activation/reset, PostgreSQL session hashes,
`HttpOnly; SameSite=Strict` cookies (`Secure` in HTTPS), explicit logout/revocation,
shared PostgreSQL rate limits, and per-request subscription eligibility checks.

**Super Admin / employee Cognito OAuth + PKCE remains unchanged**. Student users
cannot self-register. Super Admin creates/enrolls the record through the existing
Subscribers workflow, and an enrolled student activates it using the registered
email. Existing pending student `identitySub` values remain unchanged; no Cognito
account is created for students.

## Environment (do not commit secrets)

API `.env` (retain existing DB, AWS, Cognito admin and CORS settings):

```dotenv
# Must be a verified outbound email/domain in SES ap-south-1.
SES_FROM_EMAIL=students@YOUR_VERIFIED_DOMAIN.example
# Must match CORS_ORIGIN exactly; omit if same as CORS_ORIGIN.
STUDENT_APP_ORIGIN=http://localhost:5190
```

For the local Vite app, `VITE_API_ORIGIN=http://localhost:3011`. The public-facing
frontend and API must use the **same hostname** (both localhost, not mixed
localhost/127.0.0.1), because cookies are host-only. `CORS_ORIGIN` must be
`http://localhost:5190` locally. `NODE_ENV=production` rejects non-HTTPS student
origins and the cookie uses `__Host-` Secure/HttpOnly/SameSite=Strict. Use trusted
HTTPS edge termination for production and restrict CORS to the exact frontend origin.

SES setup: verify `SES_FROM_EMAIL` or its domain in the correct region, grant the API
IAM role least-privilege `ses:SendEmail` for that identity, configure production SES
sending permissions (sandbox accounts cannot email arbitrary students), and monitor
bounces/complaints. No email credentials or AWS keys belong in Git. A missing sender
returns 503 for activation requests; **student activation is not live until email
sending has been verified end to end**. This is an explicit release gate.

## Student journey

1. Super Admin enrolls student (individual or CSV) with Activation and Expiry dates.
2. Student clicks **First-time activation**, enters the enrolled email.
3. API sends a one-use link by SES; it expires after 30 minutes. The browser stores
   the secret only transiently and removes the URL fragment from browser history.
4. Student chooses a unique 12–128 character password and signs in.
5. Browser receives a signed-in **opaque** cookie; its SHA-256 digest is stored in
   PostgreSQL. No session JWT, session token, or original PDF S3 link is exposed to JavaScript; the one-time email-link token is processed transiently.
6. Login and every protected data/PDF request verify user enabled, STUDENT role,
   active subscription start/end dates, session revocation, idle timeout and expiry.
   Existing finer course/programme/subject/plan enforcement stays in document and
   schedule endpoints. An expired subscription is blocked automatically, no cron.
7. **Forgot password** emails a new single-use link; changing it revokes all
   previously issued sessions and invalidates their credential revision.

The session lifetime is 12h, idle timeout 30m. Invalid login and unknown-email
responses avoid account existence disclosure; email requests are limited by email
and IP using shared database counters. Add upstream AWS WAF/edge abuse controls
before public deployment. The shared `StudentAuthThrottle` rows require scheduled
maintenance (see below). Tokens are never logged; API redacts password, token,
Cookie and Authorization headers.

## Deployment and validation gates

1. Back up PostgreSQL and verify version-controlled source. No database reset.
2. Apply additive migration `20261029184500_student_password_sessions`, regenerate
   Prisma Client, run affected unit tests, backend/frontend typechecks and builds.
3. Restart **only** the verified DocHub API process on port 3011. Do not create
   another listener. Preserve current V20 tiles and protected document worker.
4. With a **real, enrolled test recipient whose mailbox you control**, verify
   activation, password sign-in, session persistence across refresh, logout,
   invalid-password rate limit, forgot password, single-use token replay rejection,
   disabled account, scheduled subscription, expired subscription, and a parallel
   active plan. Confirm an unauthorized student cannot access unrelated files.
5. Confirm Super Admin Cognito login and existing Uploads/PDF preview still function;
   no API endpoint ever treats a student cookie as Super Admin.
6. Verify production TLS, SES sender reputation/sandbox removal, IAM and WAF,
   auth metrics and alerts, data backup/restore and CI security tests. Do not mark
   as deployed until those checks pass. No GitHub push before owner approval.

## Retention

Run as a scheduled **separate job** using the API's database configuration:

```bash
cd services/api
npx tsx src/prune-student-auth.ts
```

This purges **only expired tokens, sessions and throttle counters older than 30
 days**; it does not touch student profiles, enrolments, credentials or audit history.

## Known scope limits

Student account activation and password reset require a verified SES sender and IAM
permissions; these cannot be verified from a source snapshot. Admin login stays on
its existing Cognito flow. Student My Learning / Live Sessions / secure PDF access
are connected to real backend routes; other unconnected student modules are not
claimed complete. The earlier Academic Mapping runtime 500 must be resolved
separately if it remains after the corrected backend is restarted.
