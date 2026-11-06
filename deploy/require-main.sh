#!/usr/bin/env bash
set -euo pipefail
[[ ${GITHUB_REF:-} == refs/heads/main && ${GITHUB_REPOSITORY:-} == Azther0z/computer-network-project ]] || {
    printf '%s\n' 'Cloud delivery is restricted to this repository main branch.' >&2; exit 1;
}
[[ ${GITHUB_SHA:-} =~ ^[0-9a-f]{40}$ ]] || exit 1
current=$(gh api "repos/$GITHUB_REPOSITORY/commits/main" --jq .sha)
[[ $current == "$GITHUB_SHA" ]] || { printf '%s\n' 'Main advanced. Use the newer delivery run.' >&2; exit 1; }
