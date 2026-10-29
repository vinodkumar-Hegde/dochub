terraform {
  required_version = ">= 1.7.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}
provider "aws" {
  region = var.aws_region
}
variable "aws_region" {
  type    = string
  default = "ap-south-1"
}
variable "environment" {
  type = string
}
variable "bucket_name" {
  type = string
}

resource "aws_kms_key" "documents" {
  description         = "DOCUSEND document encryption"
  enable_key_rotation = true
}
resource "aws_s3_bucket" "documents" {
  bucket = var.bucket_name
}
resource "aws_s3_bucket_public_access_block" "documents" {
  bucket                  = aws_s3_bucket.documents.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_versioning" "documents" {
  bucket = aws_s3_bucket.documents.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.documents.arn
    }
    bucket_key_enabled = true
  }
}
resource "aws_s3_bucket_cors_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id
  cors_rule {
    allowed_methods = ["PUT"]
    allowed_origins = [var.frontend_origin]
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }
}
variable "frontend_origin" {
  type = string
}
resource "aws_s3_bucket_lifecycle_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id
  rule {
    filter {
      prefix = ""
    }

    id     = "abort-incomplete-multipart"
    status = "Enabled"
    abort_incomplete_multipart_upload { days_after_initiation = 7 }
  }
}
resource "aws_sqs_queue" "pdf_dlq" {
  name                      = "docusend-${var.environment}-pdf-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}
resource "aws_sqs_queue" "pdf" {
  name                       = "docusend-${var.environment}-pdf"
  visibility_timeout_seconds = 1800
  sqs_managed_sse_enabled    = true
  redrive_policy             = jsonencode({ deadLetterTargetArn = aws_sqs_queue.pdf_dlq.arn, maxReceiveCount = 5 })
}
output "bucket_name" {
  value = aws_s3_bucket.documents.id
}
output "queue_url" {
  value = aws_sqs_queue.pdf.url
}
output "dead_letter_queue_url" {
  value = aws_sqs_queue.pdf_dlq.url
}
output "kms_key_arn" {
  value = aws_kms_key.documents.arn
}
