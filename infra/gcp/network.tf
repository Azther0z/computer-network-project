# These four resources already exist. imports.tf adopts them in the first reviewed apply.
resource "google_compute_network" "app" {
  project                 = var.project_id
  name                    = "talkmato-net"
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"
  mtu                     = 1460

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_compute_subnetwork" "app" {
  project                  = var.project_id
  name                     = "talkmato-sg"
  region                   = local.region
  network                  = google_compute_network.app.id
  ip_cidr_range            = "10.42.0.0/24"
  stack_type               = "IPV4_ONLY"
  private_ip_google_access = false

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_compute_firewall" "web" {
  project       = var.project_id
  name          = "talkmato-web"
  network       = google_compute_network.app.id
  direction     = "INGRESS"
  priority      = 1000
  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["talkmato"]

  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_compute_firewall" "iap_ssh" {
  project       = var.project_id
  name          = "talkmato-iap-ssh"
  network       = google_compute_network.app.id
  direction     = "INGRESS"
  priority      = 1000
  source_ranges = ["35.235.240.0/20"]
  target_tags   = ["talkmato"]

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  lifecycle {
    prevent_destroy = true
  }
}
