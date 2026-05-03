#!/usr/bin/env bash
# =============================================================================
# setup_ecr_and_oidc.sh
# AquaSense – One-time AWS bootstrap for the GitHub Actions CI/CD pipeline.
#
# What this script does:
#   1. Creates one ECR repository per service
#   2. Creates a GitHub OIDC Identity Provider in IAM (if not already present)
#   3. Creates an IAM Role that GitHub Actions can assume via OIDC
#   4. Attaches a least-privilege policy to push images to the ECR repos
#
# Usage:
#   chmod +x setup_ecr_and_oidc.sh
#   ./setup_ecr_and_oidc.sh \
#       --account   123456789012 \
#       --region    ap-south-1   \
#       --repo      Sandeep992299/AquaSense   ← your GitHub owner/repo
# =============================================================================

set -euo pipefail

# ── Defaults ─────────────────────────────────────────────────────────────────
REGION="ap-south-1"
PROJECT="aqua-sense"
GITHUB_REPO=""          # e.g. Sandeep992299/AquaSense
ACCOUNT_ID=""
ROLE_NAME="GitHubActions-AquaSense-ECRPush"

# ── Parse arguments ───────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --account) ACCOUNT_ID="$2"; shift 2 ;;
    --region)  REGION="$2";     shift 2 ;;
    --repo)    GITHUB_REPO="$2";shift 2 ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

if [[ -z "$ACCOUNT_ID" || -z "$GITHUB_REPO" ]]; then
  echo "Usage: $0 --account <AWS_ACCOUNT_ID> --region <REGION> --repo <owner/repo>"
  exit 1
fi

SERVICES=(user-service billing-service usage-service alert-service simulator)
OIDC_URL="https://token.actions.githubusercontent.com"
OIDC_THUMBPRINT="6938fd4d98bab03faadb97b34396831e3780aea1"

echo ""
echo "=================================================="
echo " AquaSense ECR + OIDC Bootstrap"
echo "=================================================="
echo " Account : $ACCOUNT_ID"
echo " Region  : $REGION"
echo " Project : $PROJECT"
echo " GH Repo : $GITHUB_REPO"
echo ""

# ── 1. Create ECR repositories ────────────────────────────────────────────────
echo "── Step 1: Creating ECR repositories ──"
for SVC in "${SERVICES[@]}"; do
  REPO_NAME="${PROJECT}-${SVC}"
  if aws ecr describe-repositories \
        --repository-names "$REPO_NAME" \
        --region "$REGION" > /dev/null 2>&1; then
    echo "  [SKIP] ECR repo already exists: $REPO_NAME"
  else
    aws ecr create-repository \
      --repository-name "$REPO_NAME" \
      --region "$REGION" \
      --image-scanning-configuration scanOnPush=true \
      --image-tag-mutability MUTABLE \
      --query 'repository.repositoryUri' \
      --output text
    echo "  [OK]   Created ECR repo: $REPO_NAME"
  fi

  # Set a lifecycle policy to keep only the last 10 images (cost control)
  aws ecr put-lifecycle-policy \
    --repository-name "$REPO_NAME" \
    --region "$REGION" \
    --lifecycle-policy-text '{
      "rules": [{
        "rulePriority": 1,
        "description": "Keep last 10 images",
        "selection": {
          "tagStatus": "any",
          "countType": "imageCountMoreThan",
          "countNumber": 10
        },
        "action": { "type": "expire" }
      }]
    }' > /dev/null
done

echo ""

# ── 2. Create GitHub OIDC Provider ───────────────────────────────────────────
echo "── Step 2: Configuring GitHub OIDC Identity Provider ──"

EXISTING=$(aws iam list-open-id-connect-providers \
  --query "OIDCProviderList[?ends_with(Arn,'token.actions.githubusercontent.com')].Arn" \
  --output text)

if [[ -n "$EXISTING" ]]; then
  echo "  [SKIP] OIDC provider already exists: $EXISTING"
  OIDC_ARN="$EXISTING"
else
  OIDC_ARN=$(aws iam create-open-id-connect-provider \
    --url "$OIDC_URL" \
    --client-id-list sts.amazonaws.com \
    --thumbprint-list "$OIDC_THUMBPRINT" \
    --query OIDCProviderArn \
    --output text)
  echo "  [OK]   OIDC provider created: $OIDC_ARN"
fi

echo ""

# ── 3. Build ECR resource ARNs for the IAM policy ────────────────────────────
ECR_ARNS=""
for SVC in "${SERVICES[@]}"; do
  REPO_NAME="${PROJECT}-${SVC}"
  ECR_ARNS+="\"arn:aws:ecr:${REGION}:${ACCOUNT_ID}:repository/${REPO_NAME}\","
done
ECR_ARNS="${ECR_ARNS%,}"   # strip trailing comma

# ── 4. Create IAM Role with OIDC trust policy ────────────────────────────────
echo "── Step 3: Creating IAM Role for GitHub Actions ──"

TRUST_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "${OIDC_ARN}"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:${GITHUB_REPO}:*"
        }
      }
    }
  ]
}
EOF
)

ROLE_EXISTS=$(aws iam get-role --role-name "$ROLE_NAME" \
  --query 'Role.RoleName' --output text 2>/dev/null || echo "")

if [[ -n "$ROLE_EXISTS" ]]; then
  echo "  [SKIP] IAM Role already exists: $ROLE_NAME"
  # Update trust policy in case the repo changed
  aws iam update-assume-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-document "$TRUST_POLICY" > /dev/null
  echo "  [OK]   Trust policy refreshed."
else
  ROLE_ARN=$(aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document "$TRUST_POLICY" \
    --description "Used by GitHub Actions to push Docker images to AquaSense ECR repos" \
    --query 'Role.Arn' \
    --output text)
  echo "  [OK]   IAM Role created: $ROLE_ARN"
fi

ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" \
  --query 'Role.Arn' --output text)

# ── 5. Create and attach inline ECR push policy ───────────────────────────────
echo ""
echo "── Step 4: Attaching ECR push policy to the role ──"

ECR_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ECRAuth",
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*"
    },
    {
      "Sid": "ECRPush",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:CompleteLayerUpload",
        "ecr:GetDownloadUrlForLayer",
        "ecr:InitiateLayerUpload",
        "ecr:PutImage",
        "ecr:UploadLayerPart",
        "ecr:BatchGetImage",
        "ecr:DescribeRepositories",
        "ecr:ListImages"
      ],
      "Resource": [${ECR_ARNS}]
    }
  ]
}
EOF
)

aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "AquaSenseECRPush" \
  --policy-document "$ECR_POLICY"

echo "  [OK]   Policy attached."
echo ""

# ── 6. Done — print the GitHub Secret value ───────────────────────────────────
echo "=================================================="
echo "  ✅  Bootstrap complete!"
echo "=================================================="
echo ""
echo "  Add this as a GitHub Secret in your repository:"
echo ""
echo "  Secret name : AWS_ROLE_ARN"
echo "  Secret value: $ROLE_ARN"
echo ""
echo "  GitHub → Settings → Secrets and variables → Actions → New repository secret"
echo ""
echo "  ECR Repositories created:"
for SVC in "${SERVICES[@]}"; do
  echo "    ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${PROJECT}-${SVC}"
done
echo ""
