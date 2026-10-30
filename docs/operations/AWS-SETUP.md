# AWS setup for DocHub

For Docker deployment, copy `deploy/.env.example` to `deploy/.env`. The root `.env.example` is only for the browser development server. Provision resources before starting the application; environment variables connect to resources, they do not create them. Use separate dev/prod resources and credentials.

## Values to obtain

| Docker/server variable | Where the value comes from | Example format only |
|---|---|---|
| `AWS_REGION` | Region selected for the deployment resources and SES verification | `ap-south-1` |
| `S3_BUCKET` | S3 bucket name | `your-company-dochub-prod` |
| `SQS_QUEUE_URL` | SQS queue → Details → URL | `https://sqs.REGION.amazonaws.com/ACCOUNT_ID/QUEUE_NAME` |
| `SES_FROM_EMAIL` | Sending address covered by a verified SES identity | `login@your-domain.com` |
| `ADMIN_EMAIL` | Existing mailbox of the administrator who receives OTPs | `admin@your-domain.com` |
| `CORS_ORIGIN` | Application's exact public HTTPS origin | `https://learn.your-domain.com` |

These are example formats, not preconfigured resources. Replace them in `deploy/.env`. Configure the region consistently. `SES_FROM_EMAIL` is the sender; `ADMIN_EMAIL` is the login/recipient. They can be different addresses.

## 1. S3: private PDF storage

1. Create a general-purpose bucket in the deployment region; copy its **name** into `S3_BUCKET`.
2. Enable all Block Public Access settings and versioning. Use bucket-owner-enforced ownership and AWS KMS encryption; ensure the runtime roles and applicable KMS key policy allow the application's upload/read operations. Do not enable public ACLs or static website hosting.
3. In bucket Permissions → CORS, enter the following JSON, replacing the example origin with your actual `CORS_ORIGIN`. This permits browser multipart uploads and reading each part's ETag. CORS does not replace IAM authorization.

```json
[
  {
    "AllowedOrigins": ["https://learn.your-domain.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

4. Add lifecycle cleanup for incomplete multipart uploads. Retain document versions according to your backup/retention policy. Protected page previews are stored in this same private bucket; a second public bucket is not required.
5. Use IAM policies scoped to this bucket/object resources. Review the actual operations in `services/api/src/documents.ts`, `document-preview-render.ts` and `worker.ts`: multipart upload/sign/complete/abort, object metadata/read/version access and private preview writes. Grant applicable KMS data-key/decrypt access as needed. Never use an administrator policy as the application role.

Reference: [AWS S3 CORS configuration](https://docs.aws.amazon.com/AmazonS3/latest/userguide/enabling-cors-examples.html).

## 2. SES: OTP delivery

1. In the SES console, select the same `AWS_REGION` used by the application.
2. Under Configuration → Identities → Create identity, verify the sending domain (preferred) or sender email. For a domain identity, publish the DNS records provided by SES and confirm verification succeeds. Configure DKIM and your domain's SPF/DMARC records.
3. Put a sending address covered by that verified identity into `SES_FROM_EMAIL`. The code uses AWS SES v2 `SendEmail` through IAM credentials; no SMTP host, port, username or password is needed.
4. Request SES production access for this region. Until it is approved, sandbox recipient-verification restrictions apply, including to the administrator mailbox. An env value alone does not verify an address or remove the sandbox.
5. Grant the API workload role `ses:SendEmail`, scoped to the approved sender identity. The PDF worker does not send OTP emails.
6. Configure bounce/complaint monitoring and sending-limit alerts. After deployment, request a sign-in code from the application and verify delivery to the configured administrator mailbox. Do not log OTPs.

References: [SES identity verification](https://docs.aws.amazon.com/ses/latest/dg/creating-identities.html) and [requesting production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html).

## 3. SQS: PDF processing

Create a standard processing queue and a dead-letter queue in the deployment region. Set visibility timeout to 1,800 seconds, enable encryption, configure redrive and alarms, and copy the processing queue's **URL** into `SQS_QUEUE_URL`. The worker renews visibility while processing. Grant the API role SendMessage and the worker role ReceiveMessage, DeleteMessage and ChangeMessageVisibility on the specific queue, with applicable queue/KMS policies. The queue contains job metadata, not PDF file bodies.

## 4. Credentials and startup

Attach workload IAM roles to the API and worker in your infrastructure. The SDK discovers their credentials; there is no S3 password or SES SMTP secret in the application env. For single-host Docker, ensure your host IAM credential provider is actually reachable by the containers. For local development only, use the documented short-lived credential injection approach. Do not copy a developer's AWS SSO profile or disable TLS verification.

Return to [DevOps handoff → First Docker run](DEVOPS-HANDOFF.md#first-docker-run) for build, migration, signature updates, administrator creation and startup commands. `ADMIN_EMAIL` takes effect when the admin bootstrap job runs. Verify a real PDF upload, publication, student preview and OTP delivery after AWS configuration. HTTP readiness alone checks the database, not AWS connectivity or email delivery.
