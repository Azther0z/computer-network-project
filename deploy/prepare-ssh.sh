#!/usr/bin/env bash
# Obtain the host key through an authenticated IAP tunnel to the exact instance, then require it for SSH.
set -euo pipefail
set +x
umask 077
: "${RUNNER_TEMP:?}"
instance_id=$(gcloud compute instances describe talkmato --project=talkmato --zone=asia-southeast1-b --format='value(id)')
[[ $instance_id =~ ^[0-9]+$ ]] || exit 1
gcloud compute start-iap-tunnel talkmato 22 --project=talkmato --zone=asia-southeast1-b \
    --local-host-port=127.0.0.1:22222 --quiet > "$RUNNER_TEMP/iap-tunnel.log" 2>&1 &
tunnel_pid=$!
trap 'kill "$tunnel_pid" 2>/dev/null || true; wait "$tunnel_pid" 2>/dev/null || true' EXIT
ready=false
for attempt in {1..60}; do
    if ssh-keyscan -T 2 -p 22222 -t ed25519 127.0.0.1 > "$RUNNER_TEMP/host-key" 2>/dev/null \
        && [[ -s $RUNNER_TEMP/host-key ]]; then
        ready=true
        break
    fi
    kill -0 "$tunnel_pid" 2>/dev/null || { printf '%s\n' 'IAP host-key connection failed.' >&2; exit 1; }
    sleep 1
done
[[ $ready == true ]] || { printf '%s\n' 'IAP SSH host key is unavailable.' >&2; exit 1; }
python3 - "$RUNNER_TEMP/host-key" "$instance_id" <<'PY'
import base64, pathlib, sys
lines = pathlib.Path(sys.argv[1]).read_text().splitlines()
keys = [line.split() for line in lines if not line.startswith('#')]
if not keys or any(len(k) != 3 or k[1] != 'ssh-ed25519' for k in keys):
    raise SystemExit('Unexpected SSH host key.')
ssh = pathlib.Path.home() / '.ssh'
ssh.mkdir(mode=0o700, exist_ok=True)
with (ssh / 'google_compute_known_hosts').open('a') as f:
    for _, kind, key in keys:
        base64.b64decode(key, validate=True)
        f.write(f'compute.{sys.argv[2]} {kind} {key}\n')
PY
printf '%s\n' 'SSH host key obtained through the authenticated IAP target.'
