#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077
: "${TF_STATE_BUCKET:?}" "${RUNNER_TEMP:?}" "${GITHUB_RUN_ID:?}" "${GITHUB_RUN_ATTEMPT:?}"
: "${GITHUB_SHA:?}" "${GITHUB_OUTPUT:?}" "${GITHUB_STEP_SUMMARY:?}"
[[ $TF_STATE_BUCKET =~ ^talkmato-tfstate-[0-9]+$ && $GITHUB_RUN_ID =~ ^[0-9]+$ && $GITHUB_RUN_ATTEMPT =~ ^[0-9]+$ ]] || exit 1
plan_uri="gs://$TF_STATE_BUCKET/plans/$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT/$GITHUB_SHA/create.tfplan"
terraform -chdir=infra/gcp init -input=false -no-color -lockfile=readonly \
    -backend-config="bucket=$TF_STATE_BUCKET" -backend-config='prefix=state/app'
# This identity cannot write app state. Delivery concurrency serializes plan/apply jobs.
if ! terraform -chdir=infra/gcp plan -input=false -no-color -lock=false \
    -out="$RUNNER_TEMP/create.tfplan" > "$RUNNER_TEMP/plan.log" 2>&1; then
    gcloud storage cp "$RUNNER_TEMP/plan.log" "${plan_uri%/*}/plan.log" --quiet
    printf '%s\n' 'Terraform planning failed. Its log is in the private plan directory.' >&2
    exit 1
fi
gcloud storage cp "$RUNNER_TEMP/plan.log" "${plan_uri%/*}/plan.log" --quiet
terraform -chdir=infra/gcp show -json "$RUNNER_TEMP/create.tfplan" \
    | python3 infra/gcp/check-plan.py --summary-file "$RUNNER_TEMP/plan-summary.json"
gcloud storage cp "$RUNNER_TEMP/create.tfplan" "$plan_uri" --quiet
plan_sha=$(sha256sum "$RUNNER_TEMP/create.tfplan" | cut -d ' ' -f 1)
printf 'plan_uri=%s\nplan_sha=%s\n' "$plan_uri" "$plan_sha" >> "$GITHUB_OUTPUT"
python3 - "$RUNNER_TEMP/plan-summary.json" <<'PY'
import json, os, sys
s = json.load(open(sys.argv[1]))
with open(os.environ['GITHUB_OUTPUT'], 'a') as f:
    f.write('has_changes=' + str(s['has_changes']).lower() + '\n')
with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as f:
    f.write(f"Terraform: {s['imports']} imports, {s['additions']} additions, 0 changes, 0 deletions.\n\n")
    f.write('The complete plan and log remain in the private GCS bucket.\n')
PY
