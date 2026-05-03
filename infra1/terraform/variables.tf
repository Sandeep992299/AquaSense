# =====================================================================
# AquaSense – Terraform Variables
# =====================================================================

variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "ap-south-1"
}

variable "project_name" {
  description = "Project name prefix for all resources"
  type        = string
  default     = "aquasense"
}

variable "environment" {
  description = "Environment name (production | staging | dev)"
  type        = string
  default     = "production"
}

# ── Networking ────────────────────────────────────────────────────────
variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "azs" {
  description = "Availability zones to use (must be 2)"
  type        = list(string)
  default     = ["ap-south-1a", "ap-south-1b"]
}

variable "public_subnet_cidrs" {
  description = "CIDR blocks for public subnets (one per AZ)"
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "private_subnet_cidrs" {
  description = "CIDR blocks for private subnets (ECS tasks)"
  type        = list(string)
  default     = ["10.0.10.0/24", "10.0.11.0/24"]
}

variable "db_subnet_cidrs" {
  description = "CIDR blocks for database subnets (Aurora)"
  type        = list(string)
  default     = ["10.0.20.0/24", "10.0.21.0/24"]
}

# ── Database ──────────────────────────────────────────────────────────
variable "db_password" {
  description = "Aurora master password (supply via -var or TF_VAR_db_password env var; stored in Secrets Manager)"
  type        = string
  sensitive   = true
}

variable "db_instance_class" {
  description = "Aurora DB instance class"
  type        = string
  default     = "db.t3.medium"
}

# ── Secrets ───────────────────────────────────────────────────────────
variable "jwt_secret" {
  description = "JWT signing secret for user-service (stored in Secrets Manager)"
  type        = string
  sensitive   = true
}

# ── ECS ───────────────────────────────────────────────────────────────
variable "service_desired_count" {
  description = "Desired ECS task count per service"
  type        = number
  default     = 2
}

variable "task_cpu" {
  description = "Fargate task CPU units (256=0.25vCPU, 512=0.5vCPU, 1024=1vCPU)"
  type        = number
  default     = 512
}

variable "task_memory" {
  description = "Fargate task memory in MiB"
  type        = number
  default     = 1024
}
