# DOCUSEND — Temporary Pause of Student Sign-In

## Decision

The administrator has requested that student login be postponed. This update keeps the current V20 layout, existing Cognito administrator login, private S3 content security, PostgreSQL enrollment rules, PDF worker, and student entitlement enforcement. **It does not make private PDFs public** and does not mint a substitute student session.

## Changes

- `src/AuthGate.tsx`: student email OTP controls are hidden by default. The admin sign-in remains available. A future controlled activation uses `VITE_STUDENT_LOGIN_ENABLED=true` only after authentication is configured and validated.
- `services/api/src/subscribers.ts`: `Add student` no longer checks Cognito/SES settings or contacts Cognito. It saves student details and approved grants in one serializable PostgreSQL transaction, performs case-insensitive reuse of existing STUDENT accounts, and creates new accounts with an internal `pending:<uuid>` identity subject. A pending subject cannot match an AWS Cognito JWT `sub` claim, so saving a subscriber does **not** grant login or PDF access. A disabled or employee-only identity cannot be silently reused. Admin actions still require `SUPER_ADMIN` authorization and create audit events.
- `src/SubscribersWorkspace.tsx`: user-facing text explains sign-in is paused rather than promising immediate OTP.
- `services/api/src/pending-subscriber-policy.ts`: pure validation rules and focused tests.

## Current behavior

1. Super Admin authenticates using the existing Cognito OAuth login.
2. Super Admin selects a locked programme and approved subjects/plans, adds student name and email, and submits.
3. Subscriptions are saved in PostgreSQL; adding the same email/grants twice is idempotent for enrollment data (no duplicate grants).
4. Student self-service login is intentionally unavailable. Protected student content continues to require a verified JWT with the matching identity subject. Neither the public student catalogue nor S3 PDFs become anonymously accessible.

## Future activation — separate approved task

Verify student ownership of the email address using the selected authentication provider, then atomically link the verified provider `sub` to the existing `pending:<uuid>` record after guarding against collisions. Do not allocate new entitlements by trusting a claimed email address. After end-to-end security tests, enable the student OTP UI; use the same database student IDs to preserve subscriptions and history. Reenable the student OTP path only when configured.

## Mac install and targeted verification

Inspect changed files first. This archive is based on the latest student email OTP integration, with the server TypeScript hotfix already applied separately. **Do not overwrite other newer local edits without review.**

```sh
cd ~/Desktop/AI_RESEARCH/dochub
unzip -l ~/Downloads/dochub-student-login-paused.zip
unzip -o ~/Downloads/dochub-student-login-paused.zip
cd services/api
npm run typecheck
node --import tsx --test src/pending-subscriber-policy.test.ts
npm run build
cd ../..
npm run build
```

Restart only the existing DOCUSEND backend on port 3011 and frontend on port 5190; no AWS/SES changes, Prisma migration, or repeat full test suite required. Verify an admin can add a new student, add the same student a second time without duplicate grants, and that unauthorized `/v1/student/materials` requests return 401. Student PDF access is **not** an acceptance criterion during the login pause.

## Known limitations and release gates

This update is based on the latest delivered source package. The Mac project may have subsequent independent changes, which need review before extraction. PostgreSQL case-insensitive email collisions are checked in a serializable transaction; consider a verified uniqueness migration after auditing existing records. Production deployment still requires clean local Git history, full final regression, security and infrastructure reviews, owner push approval, and independent CI. No changes to SES, Cognito pool or AWS credentials are included.
