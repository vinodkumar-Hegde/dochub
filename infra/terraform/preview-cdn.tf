# Opt-in private delivery. Applying infrastructure is a separate release step.
variable "enable_preview_cdn" {
  type    = bool
  default = false
}
variable "preview_signing_public_key_file" {
  type    = string
  default = ""
}
data "aws_caller_identity" "preview_cdn" {}
resource "aws_cloudfront_public_key" "previews" {
  count       = var.enable_preview_cdn ? 1 : 0
  name_prefix = "docusend-${var.environment}-previews-"
  encoded_key = file(var.preview_signing_public_key_file)
}
resource "aws_cloudfront_key_group" "previews" {
  count = var.enable_preview_cdn ? 1 : 0
  name  = "docusend-${var.environment}-previews"
  items = [aws_cloudfront_public_key.previews[0].id]
}
resource "aws_cloudfront_origin_access_control" "previews" {
  count                             = var.enable_preview_cdn ? 1 : 0
  name                              = "docusend-${var.environment}-previews"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}
resource "aws_cloudfront_cache_policy" "previews" {
  count = var.enable_preview_cdn ? 1 : 0
  name  = "docusend-${var.environment}-private-previews"
  # Positive minimum overrides S3's no-store at the edge only. Every viewer
  # request, including cache hits, still requires the trusted signed policy.
  min_ttl     = 86400
  default_ttl = 86400
  max_ttl     = 31536000
  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config { cookie_behavior = "none" }
    headers_config { header_behavior = "none" }
    query_strings_config { query_string_behavior = "none" }
  }
}
resource "aws_cloudfront_response_headers_policy" "previews" {
  count = var.enable_preview_cdn ? 1 : 0
  name  = "docusend-${var.environment}-preview-headers"
  cors_config {
    access_control_allow_credentials = false
    access_control_allow_headers { items = ["*"] }
    access_control_allow_methods { items = ["GET", "HEAD"] }
    access_control_allow_origins { items = [var.frontend_origin] }
    origin_override = true
  }
  custom_headers_config {
    items {
      header   = "Cache-Control"
      value    = "private, no-store"
      override = true
    }
    items {
      header   = "X-Content-Type-Options"
      value    = "nosniff"
      override = true
    }
  }
}
resource "aws_cloudfront_distribution" "previews" {
  count           = var.enable_preview_cdn ? 1 : 0
  enabled         = true
  is_ipv6_enabled = true
  comment         = "Private rendered PDF pages only"
  origin {
    domain_name              = aws_s3_bucket.documents.bucket_regional_domain_name
    origin_id                = "private-previews"
    origin_access_control_id = aws_cloudfront_origin_access_control.previews[0].id
  }
  default_cache_behavior {
    target_origin_id           = "private-previews"
    viewer_protocol_policy     = "https-only"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = aws_cloudfront_cache_policy.previews[0].id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.previews[0].id
    trusted_key_groups         = [aws_cloudfront_key_group.previews[0].id]
    compress                   = false
  }
  restrictions {
    geo_restriction { restriction_type = "none" }
  }
  viewer_certificate { cloudfront_default_certificate = true }
}
resource "aws_s3_bucket_policy" "preview_cdn" {
  count  = var.enable_preview_cdn ? 1 : 0
  bucket = aws_s3_bucket.documents.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "PrivatePreviewDistributionOnly"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.documents.arn}/private/previews/*"
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.previews[0].arn } }
    }]
  })
}
resource "aws_kms_key_policy" "preview_cdn" {
  count  = var.enable_preview_cdn ? 1 : 0
  key_id = aws_kms_key.documents.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "EnableAccountIAM"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.preview_cdn.account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        Sid       = "PrivatePreviewDistributionDecrypt"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "kms:Decrypt"
        Resource  = "*"
        Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.previews[0].arn } }
      }
    ]
  })
}
output "preview_cdn_origin" {
  value = var.enable_preview_cdn ? "https://${aws_cloudfront_distribution.previews[0].domain_name}" : null
}
output "preview_cdn_key_pair_id" {
  value = var.enable_preview_cdn ? aws_cloudfront_public_key.previews[0].id : null
}
