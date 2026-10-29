# Shared DocHub email OTP login

Admins and students use the same email-and-code screen. Access comes from the roles on an existing User record; the request cannot create users or select a higher role. No password, activation or reset flow is exposed by the running API. Legacy credential records remain stored for historical compatibility but are not used by the new login.

The API sends a random six-digit code with the configured SES sender. Challenges last ten minutes, accept five verification attempts, are invalidated on resend and are consumed once. Codes are salted and hashed with scrypt; plaintext codes are never returned in responses or logged. Shared database throttles bound requests and verification attempts. Unknown addresses receive a generic response without delivery or a session.

A successful verification creates an opaque HttpOnly, SameSite=Strict cookie, with Secure and the __Host prefix over HTTPS. Sessions last up to twelve hours with a thirty-minute idle limit. Every protected request rechecks the user, current roles, email, session revocation and student feature access. Email changes revoke sessions and challenges. Student subscription expiry and manual feature locks preserve OTP sign-in and profile access while blocking learning APIs.

The student profile returns named course, programme and plan subscriptions, including activation and expiry dates. Active students start on the module launcher. Administrators start on the application launcher without the removed Workspace introduction and grid-home button.

Endpoints: POST /auth/otp/request, POST /auth/otp/verify, GET /auth/session and POST /auth/logout. The existing /auth/me endpoint returns the same authorized account. Password and Cognito redirect endpoints are not registered by server.ts.

Apply 20261030010000_email_otp_login before restarting the API. SES_FROM_EMAIL must be verified and CORS_ORIGIN must be the actual application origin. Production requires HTTPS. The configured local SES account was checked read-only: sending enabled, production access enabled and sender verified. No authentication email was sent during automated testing; delivery was replaced with an in-memory test adapter.

Verification includes the API unit suite, PostgreSQL integration suite and browser tests of the email/code screens, admin routing, student module launcher, subscriptions, folder dialog and phone/iPad viewport sizes in both orientations. All integration fixtures roll back. Live OTP requests send email only when a user submits the sign-in form.
