# ── ALB Security Group (internet-facing) ─────────────────────────────
resource "aws_security_group" "alb" {
  name        = "${var.name_prefix}-alb-sg"
  description = "Allow HTTP/HTTPS from internet to ALB"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTP"
    from_port = 80; to_port = 80; protocol = "tcp"
    cidr_blocks = ["0.0.0.0/0"]; ipv6_cidr_blocks = ["::/0"]
  }
  ingress {
    description = "HTTPS"
    from_port = 443; to_port = 443; protocol = "tcp"
    cidr_blocks = ["0.0.0.0/0"]; ipv6_cidr_blocks = ["::/0"]
  }
  egress {
    from_port = 0; to_port = 0; protocol = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "${var.name_prefix}-alb-sg" }
}

# ── ECS Security Group (private, only from ALB) ───────────────────────
resource "aws_security_group" "ecs" {
  name        = "${var.name_prefix}-ecs-sg"
  description = "Allow traffic from ALB to ECS Fargate tasks"
  vpc_id      = var.vpc_id

  ingress {
    description     = "From ALB on microservice ports"
    from_port       = 8081; to_port = 8084; protocol = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  # Allow inter-service calls within the same SG
  ingress {
    description = "Inter-service communication"
    from_port   = 8081; to_port = 8084; protocol = "tcp"
    self        = true
  }
  egress {
    from_port = 0; to_port = 0; protocol = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "${var.name_prefix}-ecs-sg" }
}

# ── RDS Security Group (only from ECS) ───────────────────────────────
resource "aws_security_group" "rds" {
  name        = "${var.name_prefix}-rds-sg"
  description = "Allow PostgreSQL from ECS tasks only"
  vpc_id      = var.vpc_id

  ingress {
    description     = "PostgreSQL from ECS"
    from_port       = 5432; to_port = 5432; protocol = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }
  egress {
    from_port = 0; to_port = 0; protocol = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "${var.name_prefix}-rds-sg" }
}
