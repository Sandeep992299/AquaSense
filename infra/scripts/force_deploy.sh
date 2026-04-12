#!/usr/bin/env bash
# =====================================================================
# AquaSense – Force new ECS deployment after image push
# Usage: ./force_deploy.sh [TAG]
# =====================================================================
set -euo pipefail

TAG="${1:-latest}"
REGION="${AWS_REGION:-ap-south-1}"
CLUSTER="aquasense-production-cluster"
SERVICES=("aquasense-production-user-service" "aquasense-production-billing-service"
          "aquasense-production-usage-service" "aquasense-production-alert-service")

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  AquaSense – Force ECS Redeploy  [tag: ${TAG}]"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

for SVC in "${SERVICES[@]}"; do
  echo "▶ Forcing redeploy: ${SVC}..."
  aws ecs update-service \
    --cluster "${CLUSTER}" \
    --service "${SVC}" \
    --force-new-deployment \
    --region "${REGION}" \
    --query "service.{name:serviceName,status:status,running:runningCount,desired:desiredCount}" \
    --output table
  echo ""
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Deployment triggered. Watch rollout:"
echo "  aws ecs describe-services --cluster ${CLUSTER} \\"
echo "    --services ${SERVICES[0]} --region ${REGION} \\"
echo "    --query 'services[0].deployments'"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
