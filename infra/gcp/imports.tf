# Planning reads these existing resources. Applying records their state without recreating them.
import {
  to = google_compute_network.app
  id = "projects/talkmato/global/networks/talkmato-net"
}

import {
  to = google_compute_subnetwork.app
  id = "projects/talkmato/regions/asia-southeast1/subnetworks/talkmato-sg"
}

import {
  to = google_compute_firewall.web
  id = "projects/talkmato/global/firewalls/talkmato-web"
}

import {
  to = google_compute_firewall.iap_ssh
  id = "projects/talkmato/global/firewalls/talkmato-iap-ssh"
}
