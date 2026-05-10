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
  baseUrl: 'http://tf-aqua-sense-production-alb-840180883.ap-south-1.elb.amazonaws.com',

  endpoints: {
    auth:    '/api/auth',
    users:   '/api/users',
    billing: '/api/bills',
    usage:   '/api/usage',
    alerts:  '/api/alerts',
  },

  cognito: {
    region:     'ap-south-1',
    userPoolId: 'ap-south-1_GBei4V5ZL',
    clientId:   '53a4d878tmrcj9h9d7ec2qc2t5',
  },
};

