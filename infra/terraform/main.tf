# =====================================================================
# AquaSense – Terraform Root Module
# AWS Region: ap-south-1 (Mumbai)
# Draft: placeholder account IDs – replace before applying
# =====================================================================

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # ── Uncomment to use S3 remote state (recommended for team use) ──
  # backend "s3" {
  #   bucket         = "aquasense-terraform-state"
  #   key            = "production/terraform.tfstate"
  #   region         = "ap-south-1"
  #   encrypt        = true
  #   dynamodb_table = "aquasense-tf-locks"
  # }
}

provider "aws" {
  region = var.aws_region

  # DRAFT: replace with your actual AWS account configuration
  # profile = "aquasense-prod"   # use named CLI profile
  # or set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN env vars

  default_tags {
    tags = {
      Project     = "AquaSense"
      Environment = var.environment
      ManagedBy   = "Terraform"
      Repository  = "aquasense/infra"
    }
  }
}

# ── data ─────────────────────────────────────────────────────────────
data "aws_caller_identity" "current" {}
data "aws_region"          "current" {}

locals {
  account_id      = data.aws_caller_identity.current.account_id
  region          = data.aws_region.current.name
  resource_prefix = "tf-${replace(var.project_name, " ", "-")}"
  name_prefix     = "${local.resource_prefix}-${var.environment}"
}

# ── Networking ────────────────────────────────────────────────────────
module "vpc" {
  source = "./modules/vpc"

  name_prefix         = local.name_prefix
  vpc_cidr            = var.vpc_cidr
  public_subnet_cidrs = var.public_subnet_cidrs
  private_subnet_cidrs = var.private_subnet_cidrs
  db_subnet_cidrs     = var.db_subnet_cidrs
  azs                 = var.azs
}

# ── Security Groups ───────────────────────────────────────────────────
module "security_groups" {
  source = "./modules/security_groups"

  name_prefix = local.name_prefix
  vpc_id      = module.vpc.vpc_id
}

# ── ECR Repositories (one per microservice) ───────────────────────────
module "ecr" {
  source = "./modules/ecr"

  name_prefix = local.name_prefix
  services    = ["user-service", "billing-service", "usage-service", "alert-service", "simulator"]
}

# ── IAM Roles ─────────────────────────────────────────────────────────
module "iam" {
  source = "./modules/iam"

  name_prefix = local.name_prefix
  account_id  = local.account_id
  region      = local.region
}

# ── Secrets Manager ───────────────────────────────────────────────────
module "secrets" {
  source = "./modules/secrets"

  name_prefix  = local.name_prefix
  environment  = var.environment
  db_password  = var.db_password   # supply via tfvars or AWS_DEFAULT_REGION + aws vault
  jwt_secret   = var.jwt_secret
}

# ── PostgreSQL Database ─────────────────────────────────────────────
module "rds" {
  source = "./modules/rds"

  name_prefix         = local.name_prefix
  db_subnet_group_name = module.vpc.db_subnet_group_name
  rds_sg_id           = module.security_groups.rds_sg_id
  db_password         = var.db_password
  db_instance_class   = var.db_instance_class
  db_name             = "aquasense_db"
  environment         = var.environment
}

# ── Application Load Balancer ─────────────────────────────────────────
module "alb" {
  source = "./modules/alb"

  name_prefix       = local.name_prefix
  vpc_id            = module.vpc.vpc_id
  public_subnet_ids = module.vpc.public_subnet_ids
  alb_sg_id         = module.security_groups.alb_sg_id
}

# ── SNS + SQS Messaging ───────────────────────────────────────────────
module "messaging" {
  source = "./modules/messaging"

  name_prefix = local.name_prefix
  account_id  = local.account_id
  region      = local.region
}

# ── ECS Fargate Services ──────────────────────────────────────────────
module "ecs" {
  source = "./modules/ecs"

  name_prefix          = local.name_prefix
  vpc_id               = module.vpc.vpc_id
  private_subnet_ids   = module.vpc.private_subnet_ids
  ecs_sg_id            = module.security_groups.ecs_sg_id
  execution_role_arn   = module.iam.ecs_execution_role_arn
  task_role_arn        = module.iam.ecs_task_role_arn

  # Images from ECR
  ecr_image_uris       = module.ecr.image_uris

  # Database connection
  db_host              = module.rds.cluster_endpoint
  db_password_secret_arn = module.secrets.db_password_secret_arn
  jwt_secret_arn       = module.secrets.jwt_secret_arn

  # ALB target groups
  alb_target_group_arns = module.alb.target_group_arns

  # Messaging
  sns_topic_arn        = module.messaging.sns_topic_arn
  sqs_queue_url        = module.messaging.sqs_queue_url

  environment          = var.environment
}
