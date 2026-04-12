locals {
  # Path-based routing rules: priority → path patterns → target service
  listener_rules = {
    user-service    = { priority = 10;  paths = ["/api/auth/*", "/api/users/*"] }
    usage-service   = { priority = 20;  paths = ["/api/usage/*"] }
    billing-service = { priority = 30;  paths = ["/api/bills/*", "/api/payments/*", "/api/billing/*"] }
    alert-service   = { priority = 40;  paths = ["/api/alerts/*"] }
  }
  service_ports = {
    user-service    = 8081
    billing-service = 8082
    usage-service   = 8083
    alert-service   = 8084
  }
}

# ── Application Load Balancer ─────────────────────────────────────────
resource "aws_lb" "main" {
  name               = "${var.name_prefix}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [var.alb_sg_id]
  subnets            = var.public_subnet_ids

  enable_deletion_protection       = false   # set true in stable prod
  enable_cross_zone_load_balancing = true
  idle_timeout                     = 60

  access_logs {
    bucket  = ""      # add S3 bucket name if you want access logs
    enabled = false
  }

  tags = { Name = "${var.name_prefix}-alb" }
}

# ── HTTP Listener ─────────────────────────────────────────────────────
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  # Default action: 404 JSON if no rule matches
  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "application/json"
      message_body = jsonencode({ error = "Not found", service = "AquaSense ALB" })
      status_code  = "404"
    }
  }
}

# ── Target Groups (one per microservice) ──────────────────────────────
resource "aws_lb_target_group" "services" {
  for_each    = local.service_ports
  name        = "${var.name_prefix}-${each.key}-tg"
  port        = each.value
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"   # required for Fargate

  health_check {
    enabled             = true
    path                = "/health"
    port                = "traffic-port"
    protocol            = "HTTP"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 10
    interval            = 30
    matcher             = "200"
  }

  deregistration_delay = 30

  tags = { Name = "${var.name_prefix}-${each.key}-tg" }
}

# ── Listener Rules (path-based routing) ──────────────────────────────
resource "aws_lb_listener_rule" "services" {
  for_each     = local.listener_rules
  listener_arn = aws_lb_listener.http.arn
  priority     = each.value.priority

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.services[each.key].arn
  }

  condition {
    path_pattern { values = each.value.paths }
  }
}
