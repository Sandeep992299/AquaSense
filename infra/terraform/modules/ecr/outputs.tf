output "image_uris" {
  description = "Map of service-name => ECR URI (without tag)"
  value       = { for k, v in aws_ecr_repository.services : k => v.repository_url }
}
