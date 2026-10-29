terraform {
  backend "s3" {
    bucket       = "dochub-dev-tfstate-190716021522"
    key          = "dochub/dev/terraform.tfstate"
    region       = "ap-south-1"
    encrypt      = true
    use_lockfile = true
  }
}
