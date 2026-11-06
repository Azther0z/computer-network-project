#!/usr/bin/env bash
# Install the verified CLI into this directory. No sudo, credentials, or cloud changes.
set -euo pipefail
set +x
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[[ $(uname -sm) == 'Linux x86_64' ]] || { printf '%s\n' 'Use Cloud Shell on Linux x86_64.' >&2; exit 1; }
mkdir -p .tools
if [[ -f .tools/terraform ]] && [[ $(.tools/terraform version -json | python3 -c 'import json,sys; print(json.load(sys.stdin)["terraform_version"])') == 1.17.1 ]]; then
    printf '%s\n' 'Terraform 1.17.1 is already installed in .tools.'
    exit 0
fi
download_dir=$(mktemp -d .tools/download.XXXXXX)
trap 'rm -rf -- "$download_dir"' EXIT
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    https://releases.hashicorp.com/terraform/1.17.1/terraform_1.17.1_linux_amd64.zip \
    --output "$download_dir/terraform.zip"
python3 - "$download_dir" <<'PY'
import hashlib, pathlib, sys, zipfile
p = pathlib.Path(sys.argv[1])
archive = p / "terraform.zip"
expected = "4638628058e71a55212b1c563712eac03b902128f40740f3dc8174df12135061"
if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
    raise SystemExit("Terraform download checksum mismatch.")
with zipfile.ZipFile(archive) as z:
    executable = p / "terraform"
    executable.write_bytes(z.read("terraform"))
    executable.chmod(0o700)
PY
mv -- "$download_dir/terraform" .tools/terraform
printf '%s\n' 'Installed checksum-verified Terraform 1.17.1 in .tools.'
