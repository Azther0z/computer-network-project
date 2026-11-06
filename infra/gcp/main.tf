provider "google" {
  project = var.project_id
  region  = local.region
  zone    = local.zone
}

variable "project_id" {
  description = "Existing project linked to the credited Cloud Billing account."
  type        = string
  default     = "talkmato"

  validation {
    condition     = var.project_id == "talkmato"
    error_message = "This reviewed deployment is scoped to project talkmato. Review a project change before editing this guard."
  }
}

locals {
  region = "asia-southeast1"
  zone   = "asia-southeast1-b"
}
