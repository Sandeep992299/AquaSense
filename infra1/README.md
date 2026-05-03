# AquaSense – Infrastructure & Deployment Guide

## Architecture Overview

```
Internet
    │
    ▼
┌─────────────────────────────────────┐
│   Application Load Balancer (ALB)   │
│   Path-based routing (HTTP:80)      │
└─────┬───────┬───────┬───────┬──────┘
      │       │       │       │
  /api/auth  /api/  /api/  /api/
  /api/users usage/ bills/ alerts/
      │       │       │       │
   ┌──▼──┐ ┌──▼──┐ ┌──▼──┐ ┌──▼──┐
   │user │ │usage│ │bill │ │alert│  ECS Fargate (private subnets)
   │:8081│ │:8083│ │:8082│ │:8084│  Cloud Map: *.aquasense.local
   └──┬──┘ └──┬──┘ └──┬──┘ └──┬──┘
      └───────┴───────┴───────┘
                    │
             ┌──────▼──────┐
             │   Aurora    │
             │ PostgreSQL  │
             │   15.4      │
             └─────────────┘
                    
      SNS (asu-alerts) ──► SQS (alert-queue) ──► alert-service
```

## Directory Structure

```
infra/
├── terraform/
│   ├── main.tf                    # Root module
│   ├── variables.tf
│   ├── outputs.tf
│   ├── terraform.tfvars.example   # Copy → terraform.tfvars
│   └── modules/
│       ├── vpc/                   # VPC, subnets, IGW, NAT GW
│       ├── security_groups/       # ALB, ECS, RDS security groups
│       ├── ecr/                   # ECR repositories (4 repos)
│       ├── iam/                   # ECS execution + task roles
│       ├── secrets/               # Secrets Manager: DB password, JWT
│       ├── rds/                   # Aurora PostgreSQL 15.4
│       ├── alb/                   # ALB + listener rules + target groups
│       ├── messaging/             # SNS topic + SQS queue + DLQ
│       └── ecs/                   # ECS cluster, Cloud Map, 4 services
└── scripts/
    ├── build_and_push.sh           # Build + push images to ECR
    ├── run_migrations.sh           # Apply schema.sql + seed.sql to Aurora
    ├── smoke_test.sh               # API health + route smoke tests
    └── force_deploy.sh             # Trigger rolling ECS redeployment
```

---

## Local Development (Docker Compose)

```bash
cd services
cp .env.example .env        # edit if needed
docker-compose up --build

# Verify all 4 services healthy:
curl http://localhost:8081/health   # user-service
curl http://localhost:8082/health   # billing-service
curl http://localhost:8083/health   # usage-service
curl http://localhost:8084/health   # alert-service

# Run smoke tests:
cd ../infra/scripts && bash smoke_test.sh
```

Demo login: `rajesh@aquasense.in` / `password123`

---

## AWS Deployment – Step by Step

### Prerequisites
- AWS CLI configured: `aws configure`
- Docker Desktop running
- Terraform ≥ 1.6 installed: `terraform -version`
- `psql` installed (for migrations)

### Step 1 – Configure Variables

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with real db_password and jwt_secret
```

> ⚠️ Never commit `terraform.tfvars` to git. Add it to `.gitignore`.

### Step 2 – Provision Infrastructure

```bash
cd infra/terraform
terraform init
terraform plan -out aquasense.plan     # Review carefully
terraform apply aquasense.plan         # Creates ~40 AWS resources
```

**Expected outputs after apply:**
```
alb_dns_name             = "aqua-alb-XXXX.ap-south-1.elb.amazonaws.com"
aurora_cluster_endpoint  = "aquasense-aurora.cluster-XXX.ap-south-1.rds.amazonaws.com"
ecr_repository_urls      = { user-service = "ACCOUNT.dkr.ecr.ap-south-1.amazonaws.com/aquasense-production/user-service" ... }
```

### Step 3 – Build & Push Docker Images

```bash
# From project root (AquaSense/)
bash infra/scripts/build_and_push.sh $(git rev-parse --short HEAD)
```

### Step 4 – Run Database Migrations

```bash
export DB_PASSWORD="your-aurora-password"
bash infra/scripts/run_migrations.sh
# Answer 'y' to apply seed data for demo
```

### Step 5 – Configure Portal for AWS

Edit `portal/config.js`:
```javascript
window.AQUA_CONFIG = {
  user:    'http://aqua-alb-XXXX.ap-south-1.elb.amazonaws.com',
  billing: 'http://aqua-alb-XXXX.ap-south-1.elb.amazonaws.com',
  usage:   'http://aqua-alb-XXXX.ap-south-1.elb.amazonaws.com',
  alert:   'http://aqua-alb-XXXX.ap-south-1.elb.amazonaws.com',
};
```
All 4 services are behind one ALB — use the same DNS name for all.

### Step 6 – Validate

```bash
ALB="http://$(cd infra/terraform && terraform output -raw alb_dns_name)"
bash infra/scripts/smoke_test.sh --alb BASE="${ALB}"
```

---

## Estimated AWS Costs (ap-south-1)

| Service | Config | Est. Monthly |
|---------|--------|-------------|
| ECS Fargate | 4 × 0.5vCPU/1GB × 2 tasks | ~₹3,200 |
| Aurora PostgreSQL | db.t3.medium × 1 writer, 1 reader | ~₹7,500 |
| ALB | 1 × ALB + LCU | ~₹1,200 |
| NAT Gateway | 2 × NAT | ~₹2,800 |
| ECR | 4 repos | ~₹50 |
| Secrets Manager | 2 secrets | ~₹80 |
| **Total** | | **~₹14,830/month** |

> Cost optimisation: Use Fargate Spot for non-critical services (30–70% cheaper),  
> scale down to 1 Aurora instance in staging, use single NAT GW for dev.

---

## Service-to-Service Communication

ECS services communicate via **AWS Cloud Map** private DNS:
- `billing-service` calls `usage-service` at: `http://usage-service.aquasense.local:8083`
- `alert-service` calls `usage-service` at: `http://usage-service.aquasense.local:8083`
- No public exposure needed for inter-service traffic

---

## Teardown

```bash
cd infra/terraform
terraform destroy   # ⚠️ Destroys ALL resources including Aurora data
```
