locals {
  services = {
    "user-service" = {
      port          = 8081
      health_path   = "/health"
      environment   = [
        { name = "PORT",     value = "8081" },
        { name = "DB_HOST",  value = var.db_host },
        { name = "DB_PORT",  value = "5432" },
        { name = "DB_NAME",  value = "aquasense_db" },
        { name = "DB_USER",  value = "aqua_admin" },
        { name = "DB_SSL",   value = "true" },
        { name = "NODE_ENV", value = var.environment },
      ]
      secrets = [
        { name = "DB_PASSWORD", valueFrom = var.db_password_secret_arn },
        { name = "JWT_SECRET",  valueFrom = var.jwt_secret_arn },
      ]
    }
    "billing-service" = {
      port        = 8082
      health_path = "/health"
      environment = [
        { name = "PORT",              value = "8082" },
        { name = "DB_HOST",           value = var.db_host },
        { name = "DB_PORT",           value = "5432" },
        { name = "DB_NAME",           value = "aquasense_db" },
        { name = "DB_USER",           value = "aqua_admin" },
        { name = "DB_SSL",            value = "true" },
        { name = "USAGE_SERVICE_URL", value = "http://usage-service.aquasense.local:8083" },
        { name = "NODE_ENV",          value = var.environment },
      ]
      secrets = [
        { name = "DB_PASSWORD", valueFrom = var.db_password_secret_arn },
      ]
    }
    "usage-service" = {
      port        = 8083
      health_path = "/health"
      environment = [
        { name = "PORT",     value = "8083" },
        { name = "DB_HOST",  value = var.db_host },
        { name = "DB_PORT",  value = "5432" },
        { name = "DB_NAME",  value = "aquasense_db" },
        { name = "DB_USER",  value = "aqua_admin" },
        { name = "DB_SSL",   value = "true" },
        { name = "NODE_ENV", value = var.environment },
      ]
      secrets = [
        { name = "DB_PASSWORD", valueFrom = var.db_password_secret_arn },
      ]
    }
    "alert-service" = {
      port        = 8084
      health_path = "/health"
      environment = [
        { name = "PORT",              value = "8084" },
        { name = "DB_HOST",           value = var.db_host },
        { name = "DB_PORT",           value = "5432" },
        { name = "DB_NAME",           value = "aquasense_db" },
        { name = "DB_USER",           value = "aqua_admin" },
        { name = "DB_SSL",            value = "true" },
        { name = "USAGE_SERVICE_URL", value = "http://usage-service.aquasense.local:8083" },
        { name = "NODE_ENV",          value = var.environment },
      ]
      secrets = [
        { name = "DB_PASSWORD",   valueFrom = var.db_password_secret_arn },
        { name = "SNS_TOPIC_ARN", valueFrom = "" },  # inject ARN directly as env below
      ]
    }
  }
}

# ── ECS Cluster ───────────────────────────────────────────────────────
resource "aws_ecs_cluster" "main" {
  name = "${var.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    base              = 1
    weight            = 100
    capacity_provider = "FARGATE"
  }
}

# ── AWS Cloud Map – private service discovery ─────────────────────────
resource "aws_service_discovery_private_dns_namespace" "aquasense" {
  name        = "aquasense.local"
  description = "AquaSense microservices private DNS namespace"
  vpc         = var.vpc_id
}

resource "aws_service_discovery_service" "services" {
  for_each = local.services
  name     = each.key

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.aquasense.id
    dns_records {
      ttl  = 10
      type = "A"
    }
    routing_policy = "MULTIVALUE"
  }

  health_check_custom_config { failure_threshold = 1 }
}

# ── CloudWatch Log Groups ─────────────────────────────────────────────
resource "aws_cloudwatch_log_group" "services" {
  for_each          = local.services
  name              = "/ecs/${var.name_prefix}/${each.key}"
  retention_in_days = 30
}

# ── ECS Task Definitions ──────────────────────────────────────────────
resource "aws_ecs_task_definition" "services" {
  for_each = local.services

  family                   = "${var.name_prefix}-${each.key}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.task_role_arn

  container_definitions = jsonencode([{
    name      = each.key
    image     = "${var.ecr_image_uris[each.key]}:latest"
    essential = true

    portMappings = [{
      containerPort = each.value.port
      hostPort      = each.value.port
      protocol      = "tcp"
    }]

    environment = each.value.environment

    secrets = [for s in each.value.secrets : s if s.valueFrom != ""]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = "/ecs/${var.name_prefix}/${each.key}"
        "awslogs-region"        = "ap-south-1"
        "awslogs-stream-prefix" = "ecs"
      }
    }

    healthCheck = {
      command     = ["CMD-SHELL", "wget -qO- http://localhost:${each.value.port}${each.value.health_path} || exit 1"]
      interval    = 30
      timeout     = 10
      retries     = 3
      startPeriod = 60
    }
  }])
}

# ── ECS Services ─────────────────────────────────────────────────────
resource "aws_ecs_service" "services" {
  for_each = local.services

  name            = "${var.name_prefix}-${each.key}"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.services[each.key].arn
  desired_count   = var.service_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.ecs_sg_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = var.alb_target_group_arns[each.key]
    container_name   = each.key
    container_port   = each.value.port
  }

  service_registries {
    registry_arn = aws_service_discovery_service.services[each.key].arn
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_controller { type = "ECS" }

  # Allow running with potentially outdated task definition during deployment
  force_new_deployment = true

  lifecycle {
    ignore_changes = [desired_count]  # allow auto-scaling to manage count
  }

  depends_on = [aws_ecs_cluster.main]
}

# ── Auto Scaling ──────────────────────────────────────────────────────
resource "aws_appautoscaling_target" "services" {
  for_each           = local.services
  max_capacity       = 10
  min_capacity       = var.service_desired_count
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.services[each.key].name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
  depends_on         = [aws_ecs_service.services]
}

resource "aws_appautoscaling_policy" "cpu_scaling" {
  for_each           = local.services
  name               = "${var.name_prefix}-${each.key}-cpu-auto-scale"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.services[each.key].resource_id
  scalable_dimension = aws_appautoscaling_target.services[each.key].scalable_dimension
  service_namespace  = aws_appautoscaling_target.services[each.key].service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = 70  # scale when CPU > 70%
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}
