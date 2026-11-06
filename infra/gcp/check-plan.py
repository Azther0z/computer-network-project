#!/usr/bin/env python3
"""Check creation and steady-state plans without printing private state or changing resources."""
import argparse
import json
import sys
from pathlib import Path


EXISTING = {
    "google_compute_network.app": "projects/talkmato/global/networks/talkmato-net",
    "google_compute_subnetwork.app": "projects/talkmato/regions/asia-southeast1/subnetworks/talkmato-sg",
    "google_compute_firewall.web": "projects/talkmato/global/firewalls/talkmato-web",
    "google_compute_firewall.iap_ssh": "projects/talkmato/global/firewalls/talkmato-iap-ssh",
}
NEW = {"google_compute_address.app", "google_compute_disk.boot", "google_compute_instance.app"}


def check(plan):
    errors = []

    def require(condition, message):
        if not condition:
            errors.append(message)

    require(plan.get("errored") is not True, "Terraform marked this plan as errored.")
    require(plan.get("complete") is not False, "Terraform marked this plan as incomplete.")
    changes = {
        item["address"]: item
        for item in plan.get("resource_changes", [])
        if item.get("mode") == "managed"
    }
    require(set(changes) == set(EXISTING) | NEW, "The plan must contain exactly the seven reviewed managed resources.")
    values = {}
    imports = 0
    for address, item in changes.items():
        change = item.get("change", {})
        if address in NEW:
            require(change.get("actions") in (["create"], ["no-op"]), f"Unexpected update or deletion: {address}.")
            require(not change.get("importing"), f"Unexpected import: {address}.")
        elif address in EXISTING:
            require(change.get("actions") == ["no-op"], f"An existing resource would change: {address}.")
            importing = change.get("importing")
            if importing:
                imports += 1
                require(importing.get("id") == EXISTING[address], f"Unexpected import ID: {address}.")
        value = change.get("after") or {}
        values[address] = value
        require(value.get("project") == "talkmato", f"Unexpected or unknown project: {address}.")

    require(not any(item.get("change", {}).get("actions") != ["no-op"] for item in plan.get("resource_drift", [])),
            "The plan reports drift. Inspect it before applying.")

    network = values.get("google_compute_network.app", {})
    require(network.get("name") == "talkmato-net" and network.get("auto_create_subnetworks") is False,
            "The VPC must be the reviewed custom network.")
    require(network.get("routing_mode") == "REGIONAL" and network.get("mtu") == 1460,
            "Unexpected VPC routing mode or MTU.")
    subnet = values.get("google_compute_subnetwork.app", {})
    require(subnet.get("name") == "talkmato-sg" and subnet.get("region") == "asia-southeast1"
            and subnet.get("ip_cidr_range") == "10.42.0.0/24" and subnet.get("stack_type") == "IPV4_ONLY",
            "Unexpected subnet location, address range, or IP stack.")
    require(not subnet.get("log_config"), "Subnet flow logging is outside this cost proposal.")

    for address, name, source, ports in [
        ("google_compute_firewall.web", "talkmato-web", "0.0.0.0/0", {"80", "443"}),
        ("google_compute_firewall.iap_ssh", "talkmato-iap-ssh", "35.235.240.0/20", {"22"}),
    ]:
        rule = values.get(address, {})
        allow = rule.get("allow") or []
        require(rule.get("name") == name and rule.get("direction") == "INGRESS" and rule.get("priority") == 1000,
                f"Unexpected firewall identity or direction: {address}.")
        require(rule.get("source_ranges") == [source] and rule.get("target_tags") == ["talkmato"],
                f"Unexpected firewall sources or targets: {address}.")
        require(len(allow) == 1 and allow[0].get("protocol") == "tcp" and set(allow[0].get("ports") or []) == ports,
                f"Unexpected allowed firewall ports: {address}.")
        require(not rule.get("disabled") and not rule.get("deny") and not rule.get("log_config")
                and not rule.get("source_tags") and not rule.get("source_service_accounts")
                and not rule.get("target_service_accounts"), f"Unexpected firewall settings: {address}.")

    ip = values.get("google_compute_address.app", {})
    require(ip.get("name") == "talkmato-ip" and ip.get("region") == "asia-southeast1"
            and ip.get("address_type") == "EXTERNAL" and ip.get("ip_version") == "IPV4"
            and ip.get("network_tier") == "PREMIUM", "Unexpected static IP configuration.")
    disk = values.get("google_compute_disk.boot", {})
    require(disk.get("name") == "talkmato-boot" and disk.get("zone") == "asia-southeast1-b"
            and disk.get("size") == 50 and disk.get("type") == "pd-balanced", "Unexpected boot disk configuration.")
    disk_create = changes.get("google_compute_disk.boot", {}).get("change", {}).get("actions") == ["create"]
    require(not disk_create or disk.get("image") == "projects/ubuntu-os-cloud/global/images/family/ubuntu-2404-lts-amd64",
            "Unexpected boot image. This plan requires standard Ubuntu 24.04 amd64.")
    vm = values.get("google_compute_instance.app", {})
    require(vm.get("name") == "talkmato" and vm.get("zone") == "asia-southeast1-b"
            and vm.get("machine_type") == "e2-small" and vm.get("deletion_protection") is True,
            "Unexpected VM size, location, or deletion protection.")
    require(vm.get("tags") == ["talkmato"] and not vm.get("service_account"), "Unexpected VM tags or service account.")
    require(vm.get("metadata") == {"enable-oslogin": "TRUE", "block-project-ssh-keys": "TRUE"}
            and not vm.get("metadata_startup_script"), "Unexpected VM metadata or startup script.")
    boot = vm.get("boot_disk") or []
    require(len(boot) == 1 and boot[0].get("auto_delete") is False, "VM deletion must retain the boot disk.")
    require(not vm.get("attached_disk") and not vm.get("scratch_disk") and not vm.get("guest_accelerator"),
            "Additional VM disks or accelerators are outside this proposal.")
    interfaces = vm.get("network_interface") or []
    access = interfaces[0].get("access_config", []) if len(interfaces) == 1 else []
    require(len(interfaces) == 1 and interfaces[0].get("stack_type") == "IPV4_ONLY"
            and len(access) == 1 and access[0].get("network_tier") == "PREMIUM", "Unexpected VM network interfaces.")
    scheduling = vm.get("scheduling") or []
    require(len(scheduling) == 1 and scheduling[0].get("provisioning_model") == "STANDARD"
            and scheduling[0].get("preemptible") is False, "The VM must use standard on-demand provisioning.")
    return errors, imports


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--summary-file", type=Path)
    args = parser.parse_args()
    try:
        plan = json.load(sys.stdin)
        errors, imports = check(plan)
    except (ValueError, TypeError, KeyError, AttributeError, IndexError):
        print("Invalid Terraform plan JSON. Do not apply this plan.", file=sys.stderr)
        sys.exit(1)
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        print("Plan differs from the reviewed deployment. Stop and inspect it.", file=sys.stderr)
        sys.exit(1)
    additions = sum(item.get("change", {}).get("actions") == ["create"] for item in plan["resource_changes"] if item.get("mode") == "managed")
    summary = {"imports": imports, "additions": additions, "changes": 0, "deletions": 0, "has_changes": bool(imports or additions)}
    if args.summary_file:
        args.summary_file.write_text(json.dumps(summary) + "\n")
    print(f"Plan shape passed: {imports} imports, {additions} additions, 0 changes, 0 deletions.")
    print("This checks resource configuration, not current prices, permissions, or application readiness.")
