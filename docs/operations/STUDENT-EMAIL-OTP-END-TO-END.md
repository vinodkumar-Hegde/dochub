# DOCUSEND — Add Student → Email OTP → My Learning → PDF Preview

## Scope
This is a focused integration of the existing Cognito user pool, approved V20 subscribers screen, PostgreSQL enrollments, and S3-backed secured PDF APIs. No new authentication database, token signer, or storage provider has been introduced. Existing administrator Hosted UI sign-in stays available; student sign-in is email OTP.

## API contracts

- `POST /v1/admin/subscribers` (SUPER_ADMIN access-token required): `{displayName,email,grants:[{courseId,programmeId,subjectId,planId,validUntil}]}`. Checks course/programme/subject/plan locks and mapping before provisioning. Uses Cognito AdminCreateUser without password when configured for EMAIL_OTP; otherwise reuses a confirmed verified email identity. Appends exact enrollments without deleting other programmes. Audits changes. Idempotent on repeated assignments.
- `POST /auth/email-otp/request`: `{email}` → `{message,session}`. Session is an ephemeral Cognito challenge, not a login token; unknown email produces the same generic response with an unusable decoy challenge session. HTTP 429 throttles excessive submissions.
- `POST /auth/email-otp/verify`: `{email,code,session}` → `{access_token,expires_in}`. Cognito verifies the code; the backend does not store or email OTP codes itself. Frontend checks `/auth/me` and opens authorized student learning.
- Existing `GET /v1/student/catalogue`, `GET /v1/student/materials`, and `GET /v1/documents/:id/read` continue to enforce locked academic mappings, active enrollment, document publication, and expiring S3 access.

## One-time Cognito/SES readiness — REQUIRED BEFORE TESTING

Run `AWS_PROFILE=dochub-terraform bash scripts/check-email-otp-readiness.sh` on your Mac. This script is read-only.

Confirm all of these:
1. Existing user pool is on **Essentials or Plus**. Lite does not provide Cognito email OTP passwordless sign-in.
2. User pool sign-in policy includes `EMAIL_OTP`, with **required MFA disabled** for passwordless sign-in.
3. Existing public app client allows `ALLOW_USER_AUTH` (preserve existing OAuth code/PKCE settings and other explicit flows).
4. Cognito email delivery uses **Amazon SES** (`EmailSendingAccount=DEVELOPER`) and its sender identity is verified in `ap-south-1`. SES sandbox restrictions must permit the intended recipient addresses (or move to production SES sending).
5. The backend AWS identity has scoped permissions for `cognito-idp:DescribeUserPool`, `DescribeUserPoolClient`, `ListUsers`, `AdminCreateUser`; existing admin `AdminGetUser` may still be needed by other tools. Do not embed static AWS keys.

This update intentionally does NOT call `UpdateUserPool` or `UpdateUserPoolClient` automatically; those operations may unintentionally overwrite existing Cognito settings unless the full live configuration is preserved. Configure once via approved IaC and inspect the plan before applying. SES email delivery is handled by Cognito, not by an additional custom OTP service.

## Install and verify on Mac

1. Inspect every file in the update archive before overwriting local edits. The ZIP is an incremental update for the Subscribers integration; **install the earlier subscribers and preview updates first**.
2. `cd ~/Desktop/AI_RESEARCH/dochub && unzip -l ~/Downloads/dochub-student-email-otp-flow.zip`
3. Review and apply; run `npm run build` at frontend root.
4. `cd services/api && npm install --no-audit --no-fund && npm run typecheck && npm test && npm run build`.
5. Use one API process on 3011 and one Vite process on 5190. Set `AWS_PROFILE=dochub-terraform` on the backend. No schema change or migration is required for this update.
6. Read-only Cognito/SES preflight; resolve setup gaps through existing infrastructure-as-code, not unreviewed AWS console changes.

## Critical acceptance cases

- SUPER_ADMIN creates student with name and email and selects locked programme, subject(s), plan(s). No manual Cognito creation or link screen required.
- Student receives an email OTP, verifies it, and goes directly to Browse by Programme in My Learning; the course, subjects and published PDFs match the saved grants.
- A different email with no subscriber account cannot request a usable Cognito challenge; invalid and expired OTPs never produce access tokens.
- An unsubscribed, expired, disabled, cross-course, cross-programme, wrong-plan or wrong-subject student cannot open the PDF, including by guessing a direct document URL.
- An unpublished, quarantined, failed, deleted or unscanned PDF cannot be read by students.
- Duplicate Add Student calls do not create duplicate Cognito accounts or duplicate grants; editing and bulk assignment preserve other programmes; audit records are created for changes.
- Excess code requests or incorrect code attempts are throttled; 401/403/429/503 responses are surfaced clearly.
- Administrator Hosted UI OAuth continues working; authorization accepts only validated Cognito **access** tokens from the expected public client, never ID tokens.
- Existing published versions stay readable while new replacement versions process.

## Release limitations

The local source can be syntax-checked and pure policy tested in the delivery environment, but full TypeScript builds and Cognito/SES live delivery require the Mac's installed node_modules and valid AWS session. This update does not claim a live OTP email has been sent or that AWS has been configured. OTP rate limiting within a single Node.js process is defense-in-depth only; production deployments also require AWS WAF or centrally shared rate limiting, logging/monitoring, and HTTPS deployment. Cognito/SES account tiers and sending can carry AWS charges. There is no GitHub push.
