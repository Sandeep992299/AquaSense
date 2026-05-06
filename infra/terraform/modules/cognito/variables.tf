# =====================================================================
# AquaSense – Cognito Module Variables
# =====================================================================

variable "name_prefix" {
  description = "Resource name prefix"
  type        = string
}

variable "environment" {
  description = "Environment name (production | staging | dev)"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "ap-south-1"
}

variable "domain_prefix" {
  description = "Unique prefix for the Cognito hosted UI domain (e.g. aquasense-prod)"
  type        = string
}

variable "customer_portal_callback_urls" {
  description = "Allowed callback URLs for the customer portal app client"
  type        = list(string)
  default     = ["http://localhost:3000", "http://localhost:8080"]
}

variable "admin_portal_callback_urls" {
  description = "Allowed callback URLs for the admin portal app client"
  type        = list(string)
  default     = ["http://localhost:3001", "http://localhost:9090"]
}

variable "password_minimum_length" {
  description = "Minimum password length for both user pools"
  type        = number
  default     = 8
}

variable "mfa_configuration" {
  description = "MFA config: OFF | OPTIONAL | ON"
  type        = string
  default     = "OPTIONAL"
}
