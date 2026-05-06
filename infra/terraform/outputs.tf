# =====================================================================
# AquaSense – Terraform Outputs
# =====================================================================

output "alb_dns_name" {
  description = "ALB DNS – use this as the API base URL in portal/config.js"
  value       = module.alb.alb_dns_name
}

output "db_endpoint" {
  description = "PostgreSQL endpoint (DB_HOST for ECS tasks)"
  value       = module.rds.cluster_endpoint
  sensitive   = false
}

output "db_reader_endpoint" {
  description = "Read-only endpoint (unused for a single-instance DB)"
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

# ── Cognito ───────────────────────────────────────────────────────────
output "customer_user_pool_id" {
  description = "Cognito User Pool ID – paste into portal/config.js as userPoolId"
  value       = module.cognito.customer_user_pool_id
}

output "customer_cognito_client_id" {
  description = "Cognito App Client ID – paste into portal/config.js as clientId"
  value       = module.cognito.customer_client_id
}

output "admin_user_pool_id" {
  description = "Cognito Admin Pool ID – paste into backend/cognito-auth.js as userPoolId"
  value       = module.cognito.admin_user_pool_id
}

output "admin_cognito_client_id" {
  description = "Cognito Admin Client ID – paste into backend/cognito-auth.js as clientId"
  value       = module.cognito.admin_client_id
}

output "customer_jwks_uri" {
  description = "JWKS URI for verifying customer portal ID tokens in backend services"
  value       = module.cognito.customer_jwks_uri
}

output "admin_jwks_uri" {
  description = "JWKS URI for verifying admin portal ID tokens in backend services"
  value       = module.cognito.admin_jwks_uri
}

output "customer_pool_domain" {
  description = "Cognito hosted UI domain for the customer pool (Hosted UI fallback)"
  value       = module.cognito.customer_pool_domain
}

output "admin_pool_domain" {
  description = "Cognito hosted UI domain for the admin pool (Hosted UI fallback)"
  value       = module.cognito.admin_pool_domain
}
