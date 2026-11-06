import copy
import importlib.util
import json
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("plan_policy", HERE.parent / "check-plan.py")
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


class PlanPolicyTests(unittest.TestCase):
    def setUp(self):
        self.plan = json.loads((HERE / "initial-plan.json").read_text())

    def change(self, address):
        return next(item["change"] for item in self.plan["resource_changes"] if item["address"] == address)

    def test_initial_and_steady_state(self):
        errors, imports = policy.check(self.plan)
        self.assertEqual((errors, imports), ([], 4))
        for item in self.plan["resource_changes"]:
            item["change"]["actions"] = ["no-op"]
            item["change"].pop("importing", None)
        self.change("google_compute_disk.boot")["after"]["image"] = "projects/ubuntu-os-cloud/global/images/ubuntu-2404-pinned"
        self.assertEqual(policy.check(self.plan), ([], 0))

    def test_mutations_and_replacements_are_blocked(self):
        for address, actions in [
            ("google_compute_firewall.web", ["update"]),
            ("google_compute_disk.boot", ["delete", "create"]),
            ("google_compute_instance.app", ["delete"]),
        ]:
            with self.subTest(address=address):
                plan = copy.deepcopy(self.plan)
                item = next(item for item in plan["resource_changes"] if item["address"] == address)
                item["change"]["actions"] = actions
                self.assertTrue(policy.check(plan)[0])

    def test_public_ssh_and_backend_port_are_blocked(self):
        self.change("google_compute_firewall.iap_ssh")["after"]["source_ranges"] = ["0.0.0.0/0"]
        self.assertTrue(policy.check(self.plan)[0])
        self.setUp()
        self.change("google_compute_firewall.web")["after"]["allow"][0]["ports"].append("8080")
        self.assertTrue(policy.check(self.plan)[0])

    def test_cost_growth_and_disk_deletion_are_blocked(self):
        vm = self.change("google_compute_instance.app")["after"]
        vm["machine_type"] = "e2-standard-8"
        vm["boot_disk"][0]["auto_delete"] = True
        self.assertTrue(policy.check(self.plan)[0])

    def test_missing_extra_and_incomplete_resources_fail_closed(self):
        self.plan["complete"] = False
        self.assertTrue(policy.check(self.plan)[0])
        self.setUp()
        self.plan["resource_changes"].pop()
        self.assertTrue(policy.check(self.plan)[0])
        self.setUp()
        self.plan["resource_changes"].append({"address": "google_storage_bucket.extra", "mode": "managed", "change": {"actions": ["create"], "after": {"project": "talkmato"}}})
        self.assertTrue(policy.check(self.plan)[0])


if __name__ == "__main__":
    unittest.main()
