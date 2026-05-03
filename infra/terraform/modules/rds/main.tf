# ── PostgreSQL Instance ───────────────────────────────────────────────
resource "aws_db_instance" "postgres" {
  identifier               = "${var.name_prefix}-db"
  engine                   = "postgres"
  engine_version           = "15"
  instance_class           = var.db_instance_class
  allocated_storage        = 20
  max_allocated_storage    = 100
  storage_encrypted        = true
  db_name                  = var.db_name
  username                 = "aqua_admin"
  password                 = var.db_password
  db_subnet_group_name     = var.db_subnet_group_name
  vpc_security_group_ids   = [var.rds_sg_id]
  publicly_accessible      = false
  backup_retention_period  = var.backup_retention_period
  auto_minor_version_upgrade = true
  apply_immediately        = false
  skip_final_snapshot      = var.environment != "production"
  final_snapshot_identifier = "${var.name_prefix}-final-snapshot"
  enabled_cloudwatch_logs_exports = ["postgresql"]

  tags = { Name = "${var.name_prefix}-db" }
}

# ── CloudWatch Alarm: CPU > 80% ───────────────────────────────────────
resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "${var.name_prefix}-rds-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "PostgreSQL CPU utilization exceeds 80%"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.postgres.id }
}
