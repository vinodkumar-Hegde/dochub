# Profile login integration — release conditions

## Flow

The browser uses Cognito Managed Login's OAuth authorization-code grant with PKCE (S256). Only the short-lived access token is held in JS memory; no token is persisted to localStorage. Reloading requires reauthentication. The authenticated API verifies Cognito JWT signature, issuer and app client audience and looks up *active* roles in PostgreSQL. `GET /auth/me` exposes the UUID and assigned roles; only these become available as workspace choices. Profile switching never grants permissions; every API mutation must authorize roles server-side.

## Cognito configuration

Create a public SPA user-pool client (no secret) with authorization-code flow and PKCE. Configure callback URL `http://localhost:5190/`, allowed sign-out URL and scopes `openid`, `email`, `profile`. Enable HTTPS-only production domains and configure API `COGNITO_ISSUER`, `COGNITO_AUDIENCE` (app client ID) and `CORS_ORIGIN` correctly. Populate `src`'s Vite env vars from `.env.example` in a private local `.env` (do not commit).

**Backend role provisioning:** Assign `User` and `UserProfile` records through an authorized administrative provisioning mechanism. Do not allow public self-assignment. Creating an identity-provider user alone does not grant access.

## Important limitations and release blockers

- V20 academic content, upload actions, faculty/student records and PDF reader still use local demo data. This auth integration does **not** make those workflows production-safe. Do not expose admin mutations to production users until each is bound to authorized APIs.
- Cognito `access_token` audience/`client_id` claims differ by token type. Verify Cognito access-token validation against a real token before production. The backend checks `token_use=access` and `client_id` after issuer/signature verification; test real Cognito access tokens before release.
- Hosted UI logout revocation/global session logout is not implemented; local signout clears the in-memory access token. Cognito single sign-on can persist; implement provider-side logout and refresh/session policy before release.
- Role-specific module permissions, multi-role transitions, security tests, CSP, HTTP-only/BFF session architecture, audit logging and CSRF review remain release tasks.
- Vite environment variables are public; never put secrets in them.
