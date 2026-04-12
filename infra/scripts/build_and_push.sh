#!/usr/bin/env bash
# =====================================================================
# AquaSense – Build + Push all 4 service images to ECR
# Usage: ./build_and_push.sh [TAG]
#   TAG defaults to "latest"; use git SHA for production e.g. $(git rev-parse --short HEAD)
#
# Prerequisites:
#   - AWS CLI configured (aws configure OR env vars)
#   - Docker daemon running
#   - terraform output ecr_repository_urls must be available
#   - Run from the repo root: AquaSense/
# =====================================================================
set -euo pipefail

TAG="${1:-latest}"
REGION="${AWS_REGION:-ap-south-1}"
SERVICES=("user-service" "billing-service" "usage-service" "alert-service")

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  AquaSense – ECR Build & Push  [tag: ${TAG}]"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Resolve AWS account and ECR registry ──────────────────────────────
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REGISTRY="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
echo "▶ Account : ${ACCOUNT_ID}"
echo "▶ Registry: ${ECR_REGISTRY}"
echo ""

# ── ECR login ─────────────────────────────────────────────────────────
echo "▶ Logging in to ECR..."
aws ecr get-login-password --region "${REGION}" \
  | docker login --username AWS --password-stdin "${ECR_REGISTRY}"
echo ""

# ── Build & push each service ─────────────────────────────────────────
cd services   # Dockerfile build context must be services/ root

for SVC in "${SERVICES[@]}"; do
  REPO="${ECR_REGISTRY}/aquasense-production/${SVC}"
  echo "──────────────────────────────────────────────────"
  echo "▶ [${SVC}] Building image..."
  docker build \
    --pull \
    --cache-from "${REPO}:latest" \
    --tag "${REPO}:${TAG}" \
    --tag "${REPO}:latest" \
    --file "${SVC}/Dockerfile" \
    .

  echo "▶ [${SVC}] Pushing ${REPO}:${TAG} ..."
  docker push "${REPO}:${TAG}"
  docker push "${REPO}:latest"
  echo "✅ [${SVC}] Done"
  echo ""
done

cd ..

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  All images pushed successfully!"
echo ""
echo "  Next: Force new ECS deployments to pull :${TAG}"
echo "  Run:  ./infra/scripts/force_deploy.sh ${TAG}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
