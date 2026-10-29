# In-app notification center

Open **Notification center** from the administration workspace. Custom messages can target a course, programme or one or more plans. Additional selections narrow the audience; a single matching active subscription must satisfy the complete selection. Recipients are snapshotted at send time, deduplicated by student ID and exclude expired, scheduled, manually locked or unavailable academic mappings. New subscriptions do not receive historical messages automatically.

The composer has four editable templates, an audience estimate, attachments and final send confirmation. The server rechecks eligibility when sending. Retries of the same request ID return the original notification rather than delivering twice.

Regular notifications are generated transactionally for new material versions, copied published materials and newly published session revisions. This includes deferred PDF publication by the worker. Existing publications can be recovered through **Sync published updates**, after the administrator confirms delivery to current eligible students. Recovery preserves original publication dates, is idempotent, and excludes unpublished drafts. The inbox refreshes automatically every 15 seconds and on window focus. Repeating publication of an unchanged published version does not deliver again. Hidden material copies do not send notifications. Material notifications open the protected preview; they do not grant access to the original PDF.

Students use **Notifications** in their workspace. Listing messages does not mark them read. Opening a message records its first read time; the viewer count is the number of distinct recipients who opened it. Administrators can inspect viewer names and timestamps. These are message-open receipts, not proof of reading or downloading every attachment. Super admins can see all messages; content managers see their own messages and viewer lists.

Attachments support PDF, PNG, JPEG, TXT, CSV, DOCX and XLSX: up to three files, 5 MB each and 10 MB total. File bytes are stored in PostgreSQL separately from list metadata. Downloads require authenticated recipient or sender access and are served as attachments with no-store and nosniff headers. Expired or manually locked students retain profile access but cannot open the inbox or download files until access is restored.

Apply `20261029235000_notification_center` before restarting the API or PDF worker. Local development migration was applied to the local dochub PostgreSQL database. Production requires its own normal migration and deployment workflow.

Verification: `npm run typecheck`, `npm test` and `node --env-file=.env --import tsx --test tests/*.integration.ts` inside `services/api`; `npm run build` in the project root. Notification integration fixtures roll back and do not send messages to real students.
