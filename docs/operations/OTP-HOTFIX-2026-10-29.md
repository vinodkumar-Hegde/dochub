# DOCUSEND — targeted OTP compile and readiness correction

## Scope
- `services/api/src/server.ts`: safely narrow an unknown Fastify error before reading `statusCode`. Preserve `AuthError`, `ZodError`, HTTP 4xx and generic HTTP 500 behavior.
- `scripts/check-email-otp-readiness.sh`: use actual SESv2 `list-email-identities` fields (`VerificationStatus`, `SendingEnabled`) and show SES sandbox/production sending status.
- No changes to authorized V20 UI, Cognito user pool/app client, subscriber records, PostgreSQL schema or existing documents.

## Local verification
- `cd services/api && npm run typecheck && npm run build`
- `cd ../.. && AWS_PROFILE=dochub-terraform bash scripts/check-email-otp-readiness.sh`
- Keep only one local API instance on port 3011, existing frontend on 5190.

## One-time AWS settings after reviewing authoritative live state
- Existing Cognito pool: keep PASSWORD; add EMAIL_OTP in Sign-in policy.
- Existing app client: add ALLOW_USER_AUTH; preserve OAuth/PKCE settings and other allowed flows.
- Cognito email: choose verified Amazon SES identity in ap-south-1, DEVELOPER delivery; confirm sending status and sandbox recipient limitations.
- Do not use a partial `update-user-pool` API call that could reset unrelated settings; use approved managed configuration, and review changes first.

## Acceptance
1. Backend strict typecheck/build passes.
2. Readiness shows Essentials, PASSWORD + EMAIL_OTP, ALLOW_USER_AUTH, DEVELOPER email delivery, MFA OFF and SES identity verified.
3. Add Student creates/links identity and records authorized grants.
4. Student receives OTP, logs in, and sees only entitled published PDFs.
5. Expired/unmapped/unpublished materials deny access; existing admin sign-in continues to work.

No GitHub push or live AWS mutation performed by this package.
