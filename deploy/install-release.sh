#!/usr/bin/env bash
# CI invokes this reviewed script through IAP/OS Login on the dedicated Ubuntu VM.
set -euo pipefail
set +x
umask 077
fail() { printf '%s\n' "$1" >&2; exit 1; }
[[ $# -eq 3 && $2 =~ ^[0-9a-f]{64}$ && $3 =~ ^[0-9a-f]{40}$ ]] || fail 'Expected release archive, SHA256, and source commit.'
[[ ${EUID} -eq 0 ]] || fail 'Run through the approved deployment identity with sudo.'
[[ $(uname -m) == x86_64 ]] || fail 'This release requires x86_64.'
. /etc/os-release
[[ $ID == ubuntu && $VERSION_ID == 24.04 ]] || fail 'This release requires Ubuntu 24.04.'
archive=$(realpath -- "$1")
archive_digest=$2
commit=$3
bundle_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[[ $(sha256sum -- "$archive" | cut -d ' ' -f 1) == "$archive_digest" ]] || fail 'Release checksum mismatch.'
exec 9>/run/lock/talkmato-deploy.lock
flock -n 9 || fail 'Another host deployment is active.'

for path in /srv/talkmato /srv/talkmato/releases /var/lib/talkmato /etc/talkmato /var/backups/talkmato; do
    [[ ! -L $path ]] || fail 'A deployment directory is unexpectedly a symlink.'
done
[[ ! -e /srv/talkmato/current || -L /srv/talkmato/current ]] || fail 'The current release is not a managed symlink.'
previous=$(readlink -f /srv/talkmato/current || true)
if [[ -n $previous && -e $previous ]]; then
    [[ $previous == /srv/talkmato/releases/* && -f $previous/release.json ]] || fail 'Existing deployment requires a migration review.'
fi
install -d -m 0755 /srv/talkmato/releases
stage="/srv/talkmato/releases/.incoming-$commit-$$"
activated=false
cleanup() {
    local status=$?
    if [[ $status -ne 0 && $activated == true ]]; then
        if [[ -n $previous && -d $previous ]]; then
            ln -s "$previous" /srv/talkmato/.rollback-current
            mv -Tf /srv/talkmato/.rollback-current /srv/talkmato/current
            install -m 0644 "$previous/deploy/talkmato-backend.service" /etc/systemd/system/talkmato-backend.service
            install -m 0644 "$previous/deploy/talkmato-frontend.service" /etc/systemd/system/talkmato-frontend.service
            install -m 0644 "$previous/deploy/Caddyfile" /etc/caddy/Caddyfile
            systemctl daemon-reload
            systemctl restart talkmato-backend talkmato-frontend caddy || true
            printf '%s\n' 'Restored the previous release. The database was retained.' >&2
        else
            systemctl stop talkmato-backend talkmato-frontend caddy || true
            printf '%s\n' 'Initial deployment failed. Services are stopped; database files were retained.' >&2
        fi
    fi
    [[ ! -d $stage ]] || rm -rf -- "$stage"
    exit "$status"
}
trap cleanup EXIT
python3 "$bundle_dir/verify-release.py" "$archive" "$archive_digest" "$commit" "$stage"
[[ $("$stage/runtime/node" --version) == v24.19.0 ]] || fail 'Unexpected packaged Node version.'

if ! command -v caddy >/dev/null || ! command -v sqlite3 >/dev/null; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y ca-certificates curl caddy sqlite3
    systemctl stop caddy
fi
if ! getent passwd talkmato >/dev/null; then
    useradd --system --user-group --home-dir /var/lib/talkmato --shell /usr/sbin/nologin talkmato
fi
[[ $(id -u talkmato) -ne 0 ]] || fail 'Invalid application account.'
install -d -m 0700 -o talkmato -g talkmato /var/lib/talkmato
install -d -m 0755 -o root -g root /etc/talkmato
install -d -m 0700 -o root -g root /var/backups/talkmato

database=/var/lib/talkmato/talkmato.sqlite
[[ ! -L $database ]] || fail 'The database path is unexpectedly a symlink.'
if [[ -s $database ]]; then
    [[ -f $previous/release.json ]] || fail 'A database exists without managed release metadata.'
    python3 - "$previous/release.json" "$stage/release.json" <<'PY'
import json, sys
before, after = (json.load(open(p)) for p in sys.argv[1:])
if before['schemaSha256'] != after['schemaSha256']:
    raise SystemExit('Schema changed. Prepare a migration before deploying.')
PY
    sqlite3 "$database" ".backup '/var/backups/talkmato/before-$commit-$(date -u +%Y%m%dT%H%M%SZ).sqlite'"
fi

release="/srv/talkmato/releases/$commit-${archive_digest:0:12}"
if [[ -e $release ]]; then
    cmp -s "$release/release.json" "$stage/release.json" || fail 'Release identity collision.'
    rm -rf -- "$stage"
else
    mv -- "$stage" "$release"
fi
chown -R root:root "$release"
chmod -R a+rX "$release"
install -d -m 0750 -o talkmato -g talkmato "$release/frontend/.next/cache"
chown -R talkmato:talkmato "$release/frontend/.next/cache"
if [[ ! -e /etc/talkmato/backend.env ]]; then
    install -m 0600 -o root -g root "$release/deploy/backend.env.example" /etc/talkmato/backend.env
fi
# Preserve /etc/talkmato/ai.env. The pipeline never reads or writes real AI credentials.
install -m 0644 "$release/deploy/talkmato-backend.service" /etc/systemd/system/talkmato-backend.service
install -m 0644 "$release/deploy/talkmato-frontend.service" /etc/systemd/system/talkmato-frontend.service
install -m 0644 "$release/deploy/Caddyfile" /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

ln -s "$release" /srv/talkmato/.next-current
mv -Tf /srv/talkmato/.next-current /srv/talkmato/current
activated=true
systemd-analyze verify /etc/systemd/system/talkmato-backend.service /etc/systemd/system/talkmato-frontend.service
systemctl daemon-reload
systemctl enable talkmato-backend talkmato-frontend caddy
systemctl restart talkmato-backend talkmato-frontend

ready=false
for attempt in {1..30}; do
    if curl --fail --silent http://127.0.0.1:8080/health >/dev/null \
        && curl --fail --silent http://127.0.0.1:3000/ >/dev/null; then
        ready=true
        break
    fi
    sleep 1
done
[[ $ready == true ]] || fail 'Local application health checks failed.'
systemctl restart caddy
printf 'Activated source %s. Private AI configuration and public HTTPS need their separate checks.\n' "$commit"
