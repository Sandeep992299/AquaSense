# =====================================================================
# AquaSense – Terraform Outputs
# =====================================================================

output "alb_dns_name" {
  description = "ALB DNS – use this as the API base URL in portal/config.js"
  value       = module.alb.alb_dns_name
}

output "aurora_cluster_endpoint" {
  description = "Aurora cluster writer endpoint (DB_HOST for ECS tasks)"
  value       = module.rds.cluster_endpoint
  sensitive   = false
}

output "aurora_reader_endpoint" {
  description = "Aurora cluster reader endpoint (for read-only queries)"
  value       = module.rds.reader_endpoint
}

output "ecr_repository_urls" {
  description = "ECR repository URLs keyed by service name (use in build_and_push.sh)"
  value       = module.ecr.image_uris
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = module.ecs.cluster_name
}

output "sns_topic_arn" {
  description = "SNS alert topic ARN (set as SNS_TOPIC_ARN in alert-service)"
  value       = module.messaging.sns_topic_arn
}

output "sqs_queue_url" {
  description = "SQS alert queue URL"
  value       = module.messaging.sqs_queue_url
}

output "db_password_secret_arn" {
  description = "Secrets Manager ARN for DB password"
  value       = module.secrets.db_password_secret_arn
}

output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}

output "private_subnet_ids" {
  description = "Private subnet IDs where ECS tasks run"
  value       = module.vpc.private_subnet_ids
}
