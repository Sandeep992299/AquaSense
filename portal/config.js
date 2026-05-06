/**
 * AquaSense Customer Portal – API & Auth Configuration
 *
 * LOCAL DEV:  Services start via `docker-compose up` in services/
 * AWS DEPLOY: Replace each localhost URL with the ALB DNS name.
 *             e.g. http://aqua-alb-1234567890.ap-south-1.elb.amazonaws.com
 *             (all 4 services share one ALB via path-based target groups)
 *
 * COGNITO:    After running `terraform apply`, paste the outputs below.
 *             Run: terraform output -json | jq '{userPoolId:.customer_user_pool_id.value,clientId:.customer_cognito_client_id.value}'
 */
window.AQUA_CONFIG = {
  // ── Backend microservice URLs ──────────────────────────────────────
  user:    'http://localhost:8081',   // /api/auth/*, /api/users/*
  billing: 'http://localhost:8082',   // /api/bills/*, /api/payments/*, /api/billing/*
  usage:   'http://localhost:8083',   // /api/usage/*
  alert:   'http://localhost:8084',   // /api/alerts/*

  // ── AWS Cognito (Customer Pool) ────────────────────────────────────
  // TODO: Replace the placeholder values below with your actual Cognito outputs
  // from: terraform output customer_user_pool_id && terraform output customer_cognito_client_id
  cognito: {
    region:     'ap-south-1',
    userPoolId: 'ap-south-1_GBei4V5ZL',        // ← terraform output customer_user_pool_id
    clientId:   '53a4d878tmrcj9h9d7ec2qc2t5',   // ← terraform output customer_cognito_client_id
  },
};

