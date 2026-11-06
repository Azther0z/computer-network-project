terraform {
  required_version = "= 1.17.1"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "8.10.0"
    }
  }

  # CI supplies the private bucket and the state/app prefix during initialization.
  backend "gcs" {}
}
