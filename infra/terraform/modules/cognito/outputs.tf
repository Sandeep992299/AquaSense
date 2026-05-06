# =====================================================================
# AquaSense – Cognito Module Outputs
# =====================================================================

# ── Customer Pool ─────────────────────────────────────────────────────
output "customer_user_pool_id" {
  description = "Cognito User Pool ID for the customer portal"
  value       = aws_cognito_user_pool.customers.id
}

output "customer_user_pool_arn" {
  description = "Cognito User Pool ARN for the customer portal"
  value       = aws_cognito_user_pool.customers.arn
}

output "customer_client_id" {
  description = "App client ID for the customer portal (paste into portal/config.js)"
  value       = aws_cognito_user_pool_client.portal_client.id
}

output "customer_pool_domain" {
  description = "Hosted UI domain for the customer pool"
  value       = "https://${aws_cognito_user_pool_domain.customers.domain}.auth.${var.region}.amazoncognito.com"
}

# ── Admin Pool ────────────────────────────────────────────────────────
output "admin_user_pool_id" {
  description = "Cognito User Pool ID for the admin portal"
  value       = aws_cognito_user_pool.admins.id
}

output "admin_user_pool_arn" {
  description = "Cognito User Pool ARN for the admin portal"
  value       = aws_cognito_user_pool.admins.arn
}

output "admin_client_id" {
  description = "App client ID for the admin portal (paste into backend/cognito-auth.js)"
  value       = aws_cognito_user_pool_client.backend_client.id
}

output "admin_pool_domain" {
  description = "Hosted UI domain for the admin pool"
  value       = "https://${aws_cognito_user_pool_domain.admins.domain}.auth.${var.region}.amazoncognito.com"
}

# ── JWKS endpoints (for backend token verification) ───────────────────
output "customer_jwks_uri" {
  description = "JWKS endpoint for verifying customer portal JWTs"
  value       = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.customers.id}/.well-known/jwks.json"
}

output "admin_jwks_uri" {
  description = "JWKS endpoint for verifying admin portal JWTs"
  value       = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.admins.id}/.well-known/jwks.json"
}
