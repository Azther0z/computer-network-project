# Talkmato infrastructure

GitHub Actions now owns normal planning, infrastructure apply, and app delivery. The root is project `talkmato`. The user reports that the project, network, subnet, and two firewall rules already exist.

This configuration adopts those four resources through `imports.tf`. It adds the approved Singapore `e2-small` VM, a separate 50 GiB balanced boot disk, and a static IPv4 address. It preserves the existing project and billing link.

The backend is private GCS storage with locking and object versioning. The pipeline supplies its bucket and `state/app` prefix during initialization. No state, saved plan, credential, or service-account key belongs in Git.

See [the delivery runbook](../../docs/deployment.md) for the complete GitHub workflow, owner bootstrap, permission boundaries, first release, and recovery steps. The earlier Cloud Shell upload archive is superseded. `install-terraform.sh` remains a pinned tool installer for the one-time owner bootstrap.

## Local checks

These commands validate configuration without accessing a Google account. They do not create a plan or cloud resources:

```bash
terraform fmt -check
terraform init -backend=false -input=false -lockfile=readonly
terraform validate
python3 -m unittest discover -s tests
```

The CLI is pinned to Terraform 1.17.1. The Google provider is pinned to 8.10.0 and checked by its committed lock file. Initialize the remote backend only after the owner bootstrap creates the approved private bucket.

## Plan policy

`check-plan.py` accepts the reviewed initial and steady-state configurations. It rejects updates, replacements, deletions, extra managed resources, public SSH, exposed backend ports, changed VM size, and the wrong project or region. Initial creation expects four imports, three additions, zero changes, and zero deletions.

The VM and all other managed resources use `prevent_destroy`. The VM also has cloud deletion protection, and deleting it does not automatically delete the boot disk. A newer Ubuntu image does not replace the disk containing SQLite.

These guards require a separate review before resizing, changing the network, or tearing down the deployment. They do not stop billing or create a backup. The intended November 6–13, 2026 Bangkok window has no automatic deletion task.
