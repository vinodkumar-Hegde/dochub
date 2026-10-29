data "aws_caller_identity" "current" {}

resource "aws_cognito_user_pool" "dochub" {
  name           = "dochub-${var.environment}-users"
  user_pool_tier = "ESSENTIALS"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  mfa_configuration        = "OFF"

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 7
  }

  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  deletion_protection = "ACTIVE"

  tags = {
    Project     = "DOCUSEND"
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "dochub-${var.environment}-web"
  user_pool_id = aws_cognito_user_pool.dochub.id

  generate_secret               = false
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true

  supported_identity_providers         = ["COGNITO"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]

  callback_urls = ["${trimsuffix(var.frontend_origin, "/")}/"]
  logout_urls   = [var.frontend_origin]

  access_token_validity  = 60
  id_token_validity      = 60
  refresh_token_validity = 1

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

resource "aws_cognito_user_pool_domain" "dochub" {
  domain = "dochub-${var.environment}-${data.aws_caller_identity.current.account_id}"

  user_pool_id          = aws_cognito_user_pool.dochub.id
  managed_login_version = 1
}

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.dochub.id
}

output "cognito_client_id" {
  value = aws_cognito_user_pool_client.web.id
}

output "cognito_login_domain" {
  value = "https://${aws_cognito_user_pool_domain.dochub.domain}.auth.${var.aws_region}.amazoncognito.com"
}

output "cognito_issuer" {
  value = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.dochub.id}"
}
