terraform {
  required_version = "= 1.17.1"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "8.10.0"
    }
  }
  backend "gcs" {}
}

provider "google" {
  project = "talkmato"
  region  = "asia-southeast1"
}

variable "state_bucket" {
  description = "Private bucket created once by owner-bootstrap.sh, then imported here."
  type        = string
}

data "google_project" "app" {
  project_id = "talkmato"
}

locals {
  repository       = "Azther0z/computer-network-project"
  repository_id    = "1441738159"
  owner_id         = "145209097"
  workflow_ref     = "Azther0z/computer-network-project/.github/workflows/deploy.yml@refs/heads/main"
  object_prefix    = "projects/_/buckets/${var.state_bucket}/objects/"
  environments     = { plan = "gcp-plan", apply = "gcp-infrastructure", deploy = "production" }
  service_accounts = { plan = "talkmato-tf-plan", apply = "talkmato-tf-apply", deploy = "talkmato-deploy" }
}

resource "google_project_service" "required" {
  for_each = toset([
    "compute.googleapis.com", "iap.googleapis.com", "oslogin.googleapis.com",
    "iam.googleapis.com", "iamcredentials.googleapis.com", "sts.googleapis.com",
    "storage.googleapis.com", "cloudresourcemanager.googleapis.com",
  ])
  project            = "talkmato"
  service            = each.value
  disable_on_destroy = false
}

resource "google_storage_bucket" "state" {
  project                     = "talkmato"
  name                        = var.state_bucket
  location                    = "ASIA-SOUTHEAST1"
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  versioning { enabled = true }
  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = var.state_bucket == "talkmato-tfstate-${data.google_project.app.number}"
      error_message = "Use the deterministic state bucket for the approved talkmato project."
    }
  }
}

import {
  to = google_storage_bucket.state
  id = var.state_bucket
}

resource "google_iam_workload_identity_pool" "github" {
  project                   = "talkmato"
  workload_identity_pool_id = "talkmato-github"
  display_name              = "Talkmato GitHub Actions"
  depends_on                = [google_project_service.required]
  lifecycle { prevent_destroy = true }
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = "talkmato"
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  attribute_mapping = {
    "google.subject"                = "assertion.sub"
    "attribute.repository_id"       = "assertion.repository_id"
    "attribute.repository_owner_id" = "assertion.repository_owner_id"
    "attribute.ref"                 = "assertion.ref"
    "attribute.workflow_ref"        = "assertion.workflow_ref"
  }
  attribute_condition = "assertion.repository_id == '${local.repository_id}' && assertion.repository_owner_id == '${local.owner_id}' && assertion.ref == 'refs/heads/main' && assertion.workflow_ref == '${local.workflow_ref}'"
  oidc { issuer_uri = "https://token.actions.githubusercontent.com" }
  lifecycle { prevent_destroy = true }
}

resource "google_service_account" "github" {
  for_each     = local.service_accounts
  project      = "talkmato"
  account_id   = each.value
  display_name = "Talkmato GitHub ${each.key}"
  depends_on   = [google_project_service.required]
  lifecycle { prevent_destroy = true }
}

resource "google_service_account_iam_member" "federation" {
  for_each           = local.environments
  service_account_id = google_service_account.github[each.key].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principal://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/subject/repo:${local.repository}:environment:${each.value}"
}

# Plan can inspect compute, apply can provision it, deploy can administer the one app host.
locals {
  project_roles = {
    plan_view     = { identity = "plan", role = "roles/compute.viewer" }
    apply_vm      = { identity = "apply", role = "roles/compute.instanceAdmin.v1" }
    apply_network = { identity = "apply", role = "roles/compute.networkAdmin" }
    deploy_view   = { identity = "deploy", role = "roles/compute.viewer" }
    deploy_login  = { identity = "deploy", role = "roles/compute.osAdminLogin" }
  }
  bucket_roles = {
    plan_state  = { identity = "plan", role = "roles/storage.objectViewer", prefix = "state/app/" }
    plan_files  = { identity = "plan", role = "roles/storage.objectAdmin", prefix = "plans/" }
    apply_state = { identity = "apply", role = "roles/storage.objectAdmin", prefix = "state/app/" }
    apply_files = { identity = "apply", role = "roles/storage.objectViewer", prefix = "plans/" }
    apply_logs  = { identity = "apply", role = "roles/storage.objectCreator", prefix = "logs/" }
  }
}

resource "google_project_iam_member" "github" {
  for_each = local.project_roles
  project  = "talkmato"
  role     = each.value.role
  member   = "serviceAccount:${google_service_account.github[each.value.identity].email}"
}

resource "google_project_iam_member" "iap" {
  project = "talkmato"
  role    = "roles/iap.tunnelResourceAccessor"
  member  = "serviceAccount:${google_service_account.github["deploy"].email}"
  condition {
    title       = "SSH_only"
    description = "Allow the deployment identity to tunnel only SSH."
    expression  = "destination.port == 22"
  }
}

resource "google_storage_bucket_iam_member" "github" {
  for_each = local.bucket_roles
  bucket   = google_storage_bucket.state.name
  role     = each.value.role
  member   = "serviceAccount:${google_service_account.github[each.value.identity].email}"
  condition {
    title      = each.key
    expression = "resource.name.startsWith('${local.object_prefix}${each.value.prefix}')"
  }
}

resource "google_project_iam_custom_role" "state_metadata" {
  project     = "talkmato"
  role_id     = "talkmatoStateMetadataReader"
  title       = "Talkmato state bucket metadata"
  permissions = ["storage.buckets.get", "storage.objects.list"]
  lifecycle { prevent_destroy = true }
}

resource "google_storage_bucket_iam_member" "metadata" {
  for_each = toset(["plan", "apply"])
  bucket   = google_storage_bucket.state.name
  role     = google_project_iam_custom_role.state_metadata.name
  member   = "serviceAccount:${google_service_account.github[each.key].email}"
}

output "github_variables" {
  description = "Non-secret repository variables. Configure protected environments before enabling delivery."
  value = {
    GCP_WIF_PROVIDER             = google_iam_workload_identity_pool_provider.github.name
    GCP_TF_PLAN_SERVICE_ACCOUNT  = google_service_account.github["plan"].email
    GCP_TF_APPLY_SERVICE_ACCOUNT = google_service_account.github["apply"].email
    GCP_DEPLOY_SERVICE_ACCOUNT   = google_service_account.github["deploy"].email
    TF_STATE_BUCKET              = google_storage_bucket.state.name
  }
}
