# DOCUSEND Student Email OTP — Local Development Delivery Report

**Functionality:** Add Student (provision/lookup Cognito identity + exact PostgreSQL grants); Cognito email OTP request/verify; student lands directly in My Learning; existing scanned, published PDF reader remains entitlement-protected. Admin OAuth/PKCE remains available.

**Source files changed:** `services/api/src/auth.ts`, `services/api/src/subscribers.ts`, `services/api/src/server.ts`, `src/auth-client.ts`, `src/AuthGate.tsx`, `src/SubscribersWorkspace.tsx`, `src/subscribers-client.ts`, `src/StudentDocumentsWorkspace.tsx`, `src/auth.css`. **New:** `services/api/src/otp-policy.ts`, `services/api/src/otp-policy.test.ts`, `services/api/src/email-otp.ts`, `services/api/src/auth-policy.test.ts`, `scripts/check-email-otp-readiness.sh`, and operational notes.

**Root cause addressed:** Manual Cognito user linking blocked enrolment. Existing frontend had no direct OTP sign-in and users could not be registered through one admin transaction. Admin now creates/assigns students without manually opening Cognito.

**Security:** Cognito alone signs tokens; access tokens must match expected app-client `client_id` and `token_use`. OTP codes are not stored or logged by DOCUSEND. Unexpected emails receive a generic response and unusable decoy session. New enrolments are validated under a transaction against a locked programme. Same grants are not duplicated. Existing course/subject/plan/document-state entitlement checks remain in place. Short-lived S3 URLs and access audit logging are preserved.

**Verified locally in packaging environment:** 9 OTP/academic enrollment policy tests and 5 PDF access-policy tests passed (14 total). Changed TypeScript source files passed syntax parsing. Shell preflight passed `bash -n`. Full application builds require the real `node_modules` on the user's Mac and are NOT verified here; npm package installation in this environment timed out.

**Remaining risks:** Live Cognito passwordless feature tier, app-client ALLOW_USER_AUTH, SES sender verification and email delivery are not verifiable from this container. Per-process throttling must be backed by WAF/distributed rate limits before scaled deployment. AWS API, PostgreSQL transactional provisioning, student positive/negative E2E, lock revocation, PDF access audit, and frontend regression must be verified on Mac. Current local directory was previously reported to lack `.git` metadata; version-controlled release candidate remains a prerequisite. Production deployment and GitHub push have not occurred.

**Push readiness:** NOT READY — user approval prohibited until Mac full verification plus live AWS and entitlement E2E pass.
