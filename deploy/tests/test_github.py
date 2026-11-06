import base64
import importlib.util
import io
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("configure_github", ROOT / "deploy/configure-github.py")
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class GitHubSetupTests(unittest.TestCase):
    def setUp(self):
        stdout = patch("sys.stdout", new_callable=io.StringIO)
        stdout.start()
        self.addCleanup(stdout.stop)
        self.calls = []
        self.variables = {
            "GCP_WIF_PROVIDER": "projects/123/locations/global/workloadIdentityPools/talkmato-github/providers/github",
            "GCP_TF_PLAN_SERVICE_ACCOUNT": "talkmato-tf-plan@talkmato.iam.gserviceaccount.com",
            "GCP_TF_APPLY_SERVICE_ACCOUNT": "talkmato-tf-apply@talkmato.iam.gserviceaccount.com",
            "GCP_DEPLOY_SERVICE_ACCOUNT": "talkmato-deploy@talkmato.iam.gserviceaccount.com",
            "TF_STATE_BUCKET": "talkmato-tfstate-123",
        }

    def api(self, path, method="GET", payload=None, missing=False):
        self.calls.append((path, method, payload))
        if path == setup.BASE:
            return {"id": 1441738159, "owner": {"id": 145209097}, "visibility": "public"}
        if "/contents/" in path:
            return {"content": base64.b64encode((ROOT / ".github/workflows/deploy.yml").read_bytes()).decode()}
        if path.endswith("/deployment-branch-policies"):
            return {"branch_policies": []}
        if missing:
            return None
        return {}

    def test_preview_never_writes(self):
        with patch.object(setup, "api", side_effect=self.api), patch.object(setup, "set_variable") as variables:
            setup.configure(self.variables)
            self.assertTrue(all(call[1] == "GET" for call in self.calls))
            variables.assert_not_called()

    def test_enable_only_after_review_gates_and_variables(self):
        with patch.object(setup, "api", side_effect=self.api), patch.object(setup, "set_variable") as variables:
            setup.configure(self.variables, apply=True, enable=True)
            self.assertEqual(variables.call_args_list[0].args, ("GCP_CICD_READY", "false"))
            self.assertEqual(variables.call_args_list[-1].args, ("GCP_CICD_READY", "true"))
            environments = {path.split('/')[-1]: body for path, method, body in self.calls if method == "PUT" and "/environments/" in path}
            self.assertTrue(environments["production"]["reviewers"])
            self.assertTrue(environments["gcp-infrastructure"]["reviewers"])
            self.assertEqual(environments["gcp-plan"]["reviewers"], [])
            branches = [body for path, method, body in self.calls if method == "POST" and path.endswith('/deployment-branch-policies')]
            self.assertEqual(branches, [{"name": "main", "type": "branch"}] * 3)

    def test_conflicting_environment_is_preserved(self):
        def conflicting(path, method="GET", payload=None, missing=False):
            if path.endswith('/environments/production') and method == "GET":
                return {"deployment_branch_policy": {"custom_branch_policies": False}, "protection_rules": []}
            return self.api(path, method, payload, missing)
        with patch.object(setup, "api", side_effect=conflicting), patch.object(setup, "set_variable") as variables:
            with self.assertRaises(ValueError):
                setup.configure(self.variables, apply=True, enable=True)
            variables.assert_not_called()
            self.assertTrue(all(call[1] == "GET" for call in self.calls))


if __name__ == "__main__":
    unittest.main()
