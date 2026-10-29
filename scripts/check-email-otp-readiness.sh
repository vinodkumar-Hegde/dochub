#!/usr/bin/env bash
set -euo pipefail
# Read-only checks. Does not modify AWS infrastructure, secrets, or Cognito configuration.
: "${AWS_PROFILE:=dochub-terraform}"
: "${AWS_REGION:=ap-south-1}"
# Resolve pool/client from the authoritative local backend environment; no project-specific IDs in scripts.
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$PROJECT_ROOT/services/api/.env"
if [[ -z "${COGNITO_POOL_ID:-}" || -z "${COGNITO_CLIENT_ID:-}" ]]; then
  [[ -f "$ENV_FILE" ]] || { echo 'Missing services/api/.env; specify COGNITO_POOL_ID and COGNITO_CLIENT_ID'; exit 1; }
  ISSUER="$(sed -n 's/^COGNITO_ISSUER=//p' "$ENV_FILE" | head -1)"
  : "${COGNITO_POOL_ID:=${ISSUER##*/}}"
  : "${COGNITO_CLIENT_ID:=$(sed -n 's/^COGNITO_AUDIENCE=//p' "$ENV_FILE" | head -1)}"
fi
[[ -n "$COGNITO_POOL_ID" && -n "$COGNITO_CLIENT_ID" ]] || { echo 'Cognito pool/client configuration is missing'; exit 1; }

printf 'AWS identity (no keys printed):\n'
aws sts get-caller-identity --profile "$AWS_PROFILE" --query '{Account:Account,Arn:Arn}' --output json
printf '\nCognito user-pool passwordless and SES readiness:\n'
aws cognito-idp describe-user-pool --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --user-pool-id "$COGNITO_POOL_ID" \
  --query 'UserPool.{FeatureTier:UserPoolTier,AllowedFactors:Policies.SignInPolicy.AllowedFirstAuthFactors,EmailDelivery:EmailConfiguration.EmailSendingAccount,EmailFrom:EmailConfiguration.From,Mfa:MfaConfiguration}' --output json
printf '\nCognito public app client authentication flows:\n'
aws cognito-idp describe-user-pool-client --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --user-pool-id "$COGNITO_POOL_ID" --client-id "$COGNITO_CLIENT_ID" \
  --query 'UserPoolClient.{AppClient:ClientName,ExplicitAuthFlows:ExplicitAuthFlows}' --output json
printf '\nSES sending identity status (verify the configured sender is verified):\n'
aws sesv2 list-email-identities --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --query 'EmailIdentities[].{Identity:IdentityName,Status:VerificationStatus,SendingEnabled:SendingEnabled}' --output json
printf '\nSES account production sending access (false = sandbox):\n'
aws sesv2 get-account --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --query '{ProductionAccessEnabled:ProductionAccessEnabled,SendingEnabled:SendingEnabled}' --output json
printf '\nReadiness requirements: Essentials/Plus, EMAIL_OTP, ALLOW_USER_AUTH, SES DEVELOPER delivery, MFA not required, verified SES sender.\n'
