#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077
: "${TF_STATE_BUCKET:?}" "${PLAN_URI:?}" "${PLAN_SHA:?}" "${RUNNER_TEMP:?}" "${GITHUB_STEP_SUMMARY:?}"
[[ $TF_STATE_BUCKET =~ ^talkmato-tfstate-[0-9]+$ && $PLAN_SHA =~ ^[0-9a-f]{64}$ ]] || exit 1
[[ $PLAN_URI == "gs://$TF_STATE_BUCKET/plans/"*"/create.tfplan" ]] || exit 1
terraform -chdir=infra/gcp init -input=false -no-color -lockfile=readonly \
    -backend-config="bucket=$TF_STATE_BUCKET" -backend-config='prefix=state/app'
gcloud storage cp "$PLAN_URI" "$RUNNER_TEMP/create.tfplan" --quiet
printf '%s  %s\n' "$PLAN_SHA" "$RUNNER_TEMP/create.tfplan" | sha256sum --check --status
terraform -chdir=infra/gcp show -json "$RUNNER_TEMP/create.tfplan" | python3 infra/gcp/check-plan.py
if ! terraform -chdir=infra/gcp apply -input=false -no-color "$RUNNER_TEMP/create.tfplan" \
    > "$RUNNER_TEMP/apply.log" 2>&1; then
    gcloud storage cp "$RUNNER_TEMP/apply.log" "gs://$TF_STATE_BUCKET/logs/$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT/apply.log" --quiet
    printf '%s\n' 'Terraform apply failed. Its log is private. Inspect remote state and a fresh plan before retrying.' >&2
    exit 1
fi
ip=$(terraform -chdir=infra/gcp output -raw public_ipv4)
printf 'Infrastructure apply passed. Public IPv4: `%s`. Configure the reviewed DNS record before approving production.\n' \
    "$ip" >> "$GITHUB_STEP_SUMMARY"
