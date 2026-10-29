# DocHub V17 — Admin Workspace Prototype

The Super Admin role now uses a redesigned admin workspace with a unified icon-led module dashboard. The existing Student and other role screens are retained from V16.

## New UI
- Analytics as the first dashboard, with compact tables and metrics
- Academic Mapping: Add Course, Plan, Programme and Subject; tick plan/subject relationships; lock/unlock a programme mapping
- Uploads: Course, Programme and Materials hierarchy; prototype upload drawer with required multiple-plan mapping
- Sessions: Today/Upcoming/Completed/All tabs, search, compact rows and topic editing
- Subscribers: Course > Plan filtering, student profile drawer, multiple course/plan selection, bulk plan assignment and locally previewed profile images
- Employees: Internal employee profiles and selectable module visibility permissions
- White background, restrained accents, responsive drawer navigation; desktop icons instead of permanent left navigation

## Limitations
This is a frontend-only prototype. Changes are kept in React state, not persisted to a backend. The new subscriber model supports multiple courses for the redesigned admin UI but the legacy student access engine is still single-course, so student preview cannot yet validate multi-course entitlement. Employee permissions are mock configurations, not enforced authorization. Photo upload uses browser-local data URLs and is not saved after reload. CSV/XLSX import, actual file upload, real PDF rendering and backend notifications are not implemented in this release. Full build and browser verification were not possible because npm registry resolution failed in the current environment.

## Mac
From `~/Desktop/atte`:
```bash
unzip -o DocHub-Admin-V17.zip
cd DocHub-Admin-V17
npm install
npm run dev
```
Navigate to http://127.0.0.1:5187
