# Workspace controls

Employee accounts are persisted with department, designation, employee code, phone and revision. Only SUPER_ADMIN can create or edit employee profiles. Module permissions use View and Manage; Manage requires View. Every protected module API rechecks the current permissions, and deferred PDF publication rechecks Manage permission before publishing. Existing ownership and document-lock rules still apply. Employee email changes and disabled sign-in revoke sessions and outstanding codes.

Analytics has subscriber engagement and material/session sections. Filters select course, programme, plan, subscription status and activity dates. Students are deduplicated within course/plan counts. Inactive means no recorded activity in the selected period; it does not deactivate the profile. Opened/not-opened counts use distinct matching subscribers, current view records and historical authorized-open audit events. Inventory counts are current published PDFs; session counts include all published sessions unless date filters are set. These are authorized-open records, not proof a student read every page.

Watermark settings are versioned and stored centrally. Position, colour, opacity, rotation and font size are reflected in the student reader and personalized PDF exports. Exactly one personalized watermark is drawn per page; no repeating marks or additional footer mark is added. Protected previews remain API-authorized. Admins also have a responsive page reader when prepared page images are available; files without prepared previews retain the existing administrator PDF fallback.

Apply all committed migrations before starting the API and workers. Configure administrator login through the bootstrap job in [DevOps handoff](DEVOPS-HANDOFF.md#first-docker-run).
