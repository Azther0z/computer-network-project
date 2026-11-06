resource "google_compute_address" "app" {
  project      = var.project_id
  name         = "talkmato-ip"
  region       = local.region
  address_type = "EXTERNAL"
  ip_version   = "IPV4"
  network_tier = "PREMIUM"

  lifecycle {
    prevent_destroy = true
  }
}

# Keep the database disk as its own resource, separate from instance deletion.
resource "google_compute_disk" "boot" {
  project = var.project_id
  name    = "talkmato-boot"
  zone    = local.zone
  type    = "pd-balanced"
  size    = 50
  image   = "projects/ubuntu-os-cloud/global/images/family/ubuntu-2404-lts-amd64"

  lifecycle {
    prevent_destroy = true
    # A newer image in this family is not a reason to replace a disk containing SQLite.
    ignore_changes = [image]
  }
}

resource "google_compute_instance" "app" {
  project             = var.project_id
  name                = "talkmato"
  zone                = local.zone
  machine_type        = "e2-small"
  deletion_protection = true
  tags                = ["talkmato"]

  boot_disk {
    source      = google_compute_disk.boot.id
    auto_delete = false
  }

  network_interface {
    subnetwork = google_compute_subnetwork.app.id
    stack_type = "IPV4_ONLY"

    access_config {
      nat_ip       = google_compute_address.app.address
      network_tier = "PREMIUM"
    }
  }

  # No service_account block: this application does not need a Google API identity.
  metadata = {
    enable-oslogin         = "TRUE"
    block-project-ssh-keys = "TRUE"
  }

  scheduling {
    provisioning_model  = "STANDARD"
    preemptible         = false
    automatic_restart   = true
    on_host_maintenance = "MIGRATE"
  }

  lifecycle {
    prevent_destroy = true
  }
}
