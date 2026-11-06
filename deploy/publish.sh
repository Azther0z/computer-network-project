#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077
: "${RELEASE_DIR:?}" "${ARCHIVE_SHA256:?}" "${GITHUB_SHA:?}" "${GITHUB_RUN_ID:?}" "${RUNNER_TEMP:?}"
[[ $ARCHIVE_SHA256 =~ ^[0-9a-f]{64}$ && $GITHUB_SHA =~ ^[0-9a-f]{40}$ && $GITHUB_RUN_ID =~ ^[0-9]+$ ]] || exit 1
export TALKMATO_PUBLIC_IP
TALKMATO_PUBLIC_IP=$(gcloud compute instances describe talkmato --project=talkmato --zone=asia-southeast1-b \
    --format='value(networkInterfaces[0].accessConfigs[0].natIP)')
python3 - <<'PY'
import os, socket
expected = os.environ['TALKMATO_PUBLIC_IP']
addresses = {row[4][0] for row in socket.getaddrinfo('talkmato.azther0z.online', 443, type=socket.SOCK_STREAM)}
if addresses != {expected}:
    raise SystemExit('DNS must resolve directly to the current VM IPv4 before production deployment.')
PY
bash deploy/prepare-ssh.sh
ssh_args=(--project=talkmato --zone=asia-southeast1-b --tunnel-through-iap --quiet --ssh-key-expire-after=15m --strict-host-key-checking=yes)
incoming="talkmato-incoming/$GITHUB_SHA-$GITHUB_RUN_ID"
gcloud compute ssh talkmato "${ssh_args[@]}" --command="install -d -m 0700 $incoming"
gcloud compute scp "$RELEASE_DIR/talkmato-release.tar.gz" "talkmato:$incoming/talkmato-release.tar.gz" "${ssh_args[@]}"
gcloud compute ssh talkmato "${ssh_args[@]}" --command="bash -s -- $GITHUB_SHA $ARCHIVE_SHA256 $GITHUB_RUN_ID" <<'REMOTE'
set -euo pipefail
cd "talkmato-incoming/$1-$3"
printf '%s  %s\n' "$2" talkmato-release.tar.gz | sha256sum --check --status
tar -xzf talkmato-release.tar.gz deploy/install-release.sh deploy/verify-release.py
sudo bash deploy/install-release.sh "$PWD/talkmato-release.tar.gz" "$2" "$1"
REMOTE
https_ready=false
for attempt in {1..30}; do
    if curl --fail --silent --max-time 5 https://talkmato.azther0z.online/health >/dev/null; then
        https_ready=true
        break
    fi
    sleep 2
done
[[ $https_ready == true ]] || { printf '%s\n' 'Public HTTPS health did not pass. Inspect Caddy and DNS.' >&2; exit 1; }
"$RELEASE_DIR/verified/runtime/node" "$RELEASE_DIR/verified/deploy/smoke.mjs"
