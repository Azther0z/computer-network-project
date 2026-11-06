#!/usr/bin/env bash
# One-time owner setup for remote state and GitHub federation. Run only after reviewing its account effects.
set -euo pipefail
set +x
umask 077
repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd -- "$repo_root"
[[ $(git branch --show-current) == main ]] || { printf '%s\n' 'Run the reviewed main revision.' >&2; exit 1; }
[[ ! -e infra/gcp/.state/terraform.tfstate ]] || { printf '%s\n' 'Existing local app state needs migration before setup.' >&2; exit 1; }
bash infra/gcp/install-terraform.sh
export PATH="$repo_root/infra/gcp/.tools:$PATH"
gcloud config set project talkmato
gcloud services enable storage.googleapis.com cloudresourcemanager.googleapis.com iam.googleapis.com \
    iamcredentials.googleapis.com sts.googleapis.com compute.googleapis.com iap.googleapis.com oslogin.googleapis.com \
    --project=talkmato
project_number=$(gcloud projects describe talkmato --format='value(projectNumber)')
[[ $project_number =~ ^[0-9]+$ ]] || { printf '%s\n' 'Could not establish the project number.' >&2; exit 1; }
export TF_VAR_state_bucket="talkmato-tfstate-$project_number"
existing_bucket=$(gcloud storage buckets list --project=talkmato --filter="name=$TF_VAR_state_bucket" --format='value(name)')
if [[ -z $existing_bucket ]]; then
    gcloud storage buckets create "gs://$TF_VAR_state_bucket" --project=talkmato --location=asia-southeast1 \
        --uniform-bucket-level-access --public-access-prevention
fi
# Keep a recoverable state history before Terraform writes its first bootstrap state.
gcloud storage buckets update "gs://$TF_VAR_state_bucket" --versioning
mkdir -p infra/bootstrap/.state
terraform -chdir=infra/bootstrap init -input=false -backend-config="bucket=$TF_VAR_state_bucket" -backend-config='prefix=state/bootstrap'
# GCS creates an empty state under an initialization lock. Do that once as owner,
# so the read-only CI plan identity never needs permission to create app state.
terraform -chdir=infra/gcp init -input=false -backend-config="bucket=$TF_VAR_state_bucket" -backend-config='prefix=state/app'
terraform -chdir=infra/gcp state list >/dev/null
terraform -chdir=infra/bootstrap plan -input=false -out=.state/bootstrap.tfplan
printf '%s\n' 'Owner bootstrap plan is ready. Inspect it before applying.' \
    'Apply with: terraform -chdir=infra/bootstrap apply .state/bootstrap.tfplan' \
    'Then export the non-secret repository variables with: terraform -chdir=infra/bootstrap output -json github_variables'
