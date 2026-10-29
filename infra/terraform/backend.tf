# Supply backend settings at init; no account-specific state location in source.
terraform {
  backend "s3" {}
}
