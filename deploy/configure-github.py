#!/usr/bin/env python3
"""Configure reviewed GitHub environments and non-secret federation variables through gh."""
import argparse
import base64
import json
from pathlib import Path
import re
import subprocess

REPOSITORY = "Azther0z/computer-network-project"
BASE = f"repos/{REPOSITORY}"
CHECK = "Test, build, and validate"
VARIABLES = {
    "GCP_WIF_PROVIDER", "GCP_TF_PLAN_SERVICE_ACCOUNT", "GCP_TF_APPLY_SERVICE_ACCOUNT",
    "GCP_DEPLOY_SERVICE_ACCOUNT", "TF_STATE_BUCKET",
}


def api(path, method="GET", payload=None, missing=False):
    command = ["gh", "api", path, "--method", method]
    if payload is not None:
        command += ["--input", "-"]
    result = subprocess.run(command, input=json.dumps(payload) if payload is not None else None,
                            text=True, capture_output=True)
    if result.returncode:
        if missing and "HTTP 404" in result.stderr:
            return None
        raise RuntimeError(f"GitHub API request failed: {method} {path}. Inspect permissions without exposing credentials.")
    return json.loads(result.stdout) if result.stdout.strip() else None


def configure(variables, apply=False, enable=False):
    if set(variables) != VARIABLES or not all(isinstance(value, str) for value in variables.values()):
        raise ValueError("Provide only the non-secret github_variables output from the owner bootstrap.")
    if not re.fullmatch(r"talkmato-tfstate-[0-9]+", variables["TF_STATE_BUCKET"]):
        raise ValueError("Unexpected state bucket.")
    if not re.fullmatch(r"projects/[0-9]+/locations/global/workloadIdentityPools/talkmato-github/providers/github", variables["GCP_WIF_PROVIDER"]):
        raise ValueError("Unexpected identity provider.")
    for name, account in [("GCP_TF_PLAN_SERVICE_ACCOUNT", "talkmato-tf-plan"),
                          ("GCP_TF_APPLY_SERVICE_ACCOUNT", "talkmato-tf-apply"),
                          ("GCP_DEPLOY_SERVICE_ACCOUNT", "talkmato-deploy")]:
        if variables[name] != f"{account}@talkmato.iam.gserviceaccount.com":
            raise ValueError("Unexpected deployment service account.")
    repo = api(BASE)
    if str(repo["id"]) != "1441738159" or str(repo["owner"]["id"]) != "145209097" or repo["visibility"] != "public":
        raise ValueError("Repository identity or visibility differs from the reviewed setup.")
    reviewer = repo["owner"]["id"]
    root = Path(__file__).resolve().parents[1]
    remote = api(f"{BASE}/contents/.github/workflows/deploy.yml?ref=main")
    if base64.b64decode(remote["content"]) != (root / ".github/workflows/deploy.yml").read_bytes():
        raise ValueError("Merge the reviewed workflow into main before enabling delivery.")

    environments = {"gcp-plan": [], "gcp-infrastructure": [{"type": "User", "id": reviewer}],
                    "production": [{"type": "User", "id": reviewer}]}
    desired = []
    for name, reviewers in environments.items():
        path = f"{BASE}/environments/{name}"
        current = api(path, missing=True)
        if current:
            policy = current.get("deployment_branch_policy") or {}
            rules = current.get("protection_rules") or []
            actual = next((rule for rule in rules if rule["type"] == "required_reviewers"), {})
            actual_ids = {entry["reviewer"]["id"] for entry in actual.get("reviewers", [])}
            wanted_ids = {entry["id"] for entry in reviewers}
            if not policy.get("custom_branch_policies") or policy.get("protected_branches") or actual_ids != wanted_ids:
                raise ValueError(f"Existing {name} protection differs. Review it before changing account policy.")
            branches = api(f"{path}/deployment-branch-policies")["branch_policies"]
            if branches and any(item["name"] != "main" or item.get("type", "branch") != "branch" for item in branches):
                raise ValueError(f"Existing {name} deployment branches differ. Preserve them until reviewed.")
        desired.append((path, {"wait_timer": 0, "prevent_self_review": False, "reviewers": reviewers,
                               "deployment_branch_policy": {"protected_branches": False, "custom_branch_policies": True}}))

    protection = api(f"{BASE}/branches/main/protection", missing=True)
    if protection:
        checks = protection.get("required_status_checks") or {}
        contexts = set(checks.get("contexts", [])) | {item["context"] for item in checks.get("checks", [])}
        if CHECK not in contexts or not checks.get("strict") or not protection.get("required_pull_request_reviews"):
            raise ValueError("Existing main protection needs a separate merge review. It was not overwritten.")
    print("Prepared three main-only environments, owner review for apply/production, five public variables, and required CI on main.")
    if not apply:
        print("Preview only. Pass --apply after account-change approval. Use --enable-delivery only when initial host deployment is authorized.")
        return
    # Disable delivery until every environment and variable is configured successfully.
    set_variable("GCP_CICD_READY", "false")
    for path, payload in desired:
        api(path, "PUT", payload)
        branches = api(f"{path}/deployment-branch-policies")["branch_policies"]
        if not branches:
            api(f"{path}/deployment-branch-policies", "POST", {"name": "main", "type": "branch"})
    if not protection:
        api(f"{BASE}/branches/main/protection", "PUT", {
            "required_status_checks": {"strict": True, "contexts": [CHECK]}, "enforce_admins": True,
            "required_pull_request_reviews": {"required_approving_review_count": 0, "dismiss_stale_reviews": True},
            "restrictions": None, "allow_force_pushes": False, "allow_deletions": False,
        })
    for name, value in variables.items():
        set_variable(name, value)
    set_variable("GCP_CICD_READY", "true" if enable else "false")
    print("GitHub setup complete. No workflow was dispatched.")


def set_variable(name, value):
    subprocess.run(["gh", "variable", "set", name, "--repo", REPOSITORY, "--body", value], check=True, capture_output=True)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("variables", type=Path, help="Non-secret output from terraform output -json github_variables")
    p.add_argument("--apply", action="store_true")
    p.add_argument("--enable-delivery", action="store_true")
    a = p.parse_args()
    if a.enable_delivery and not a.apply:
        p.error("--enable-delivery requires --apply")
    try:
        configure(json.loads(a.variables.read_text()), a.apply, a.enable_delivery)
    except (ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error))
