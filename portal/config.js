/**
 * AquaSense Customer Portal – API Configuration
 *
 * LOCAL DEV:  Services start via `docker-compose up` in services/
 * AWS DEPLOY: Replace each localhost URL with the ALB DNS name.
 *             e.g. http://aqua-alb-1234567890.ap-south-1.elb.amazonaws.com
 *             (all 4 services share one ALB via path-based target groups)
 */
window.AQUA_CONFIG = {
  user:    'http://localhost:8081',   // /api/auth/*, /api/users/*
  billing: 'http://localhost:8082',   // /api/bills/*, /api/payments/*, /api/billing/*
  usage:   'http://localhost:8083',   // /api/usage/*
  alert:   'http://localhost:8084',   // /api/alerts/*
};
