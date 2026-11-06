output "public_ipv4" {
  description = "Static IPv4 for the later reviewed DNS A record."
  value       = google_compute_address.app.address
}

output "vm_name" {
  value = google_compute_instance.app.name
}

output "zone" {
  value = local.zone
}

output "public_url" {
  description = "Intended app address. This output does not establish a running deployment."
  value       = "https://talkmato.azther0z.online"
}
