resource "random_password" "aurora_master" {
  length           = 24
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

# ── Aurora PostgreSQL Cluster ─────────────────────────────────────────
resource "aws_rds_cluster" "aurora" {
  cluster_identifier      = "${var.name_prefix}-aurora"
  engine                  = "aurora-postgresql"
  engine_version          = "15.4"
  database_name           = "aquasense_db"
  master_username         = "aqua_admin"
  master_password         = var.db_password
  db_subnet_group_name    = var.db_subnet_group_name
  vpc_security_group_ids  = [var.rds_sg_id]

  storage_encrypted        = true
  backup_retention_period  = 7
  preferred_backup_window  = "02:00-03:00"
  preferred_maintenance_window = "sun:04:00-sun:05:00"

  deletion_protection      = var.environment == "production" ? false : false  # set true once stable
  skip_final_snapshot      = var.environment != "production"
  final_snapshot_identifier = "${var.name_prefix}-final-snapshot"

  enabled_cloudwatch_logs_exports = ["postgresql"]

  tags = { Name = "${var.name_prefix}-aurora" }
}

# ── Aurora Instance ───────────────────────────────────────────────────
resource "aws_rds_cluster_instance" "aurora_instance" {
  count                = var.environment == "production" ? 2 : 1  # 2 for HA in prod
  identifier           = "${var.name_prefix}-aurora-${count.index}"
  cluster_identifier   = aws_rds_cluster.aurora.id
  instance_class       = var.db_instance_class
  engine               = aws_rds_cluster.aurora.engine
  engine_version       = aws_rds_cluster.aurora.engine_version
  publicly_accessible  = false

  performance_insights_enabled = true
  monitoring_interval          = 60  # Enhanced Monitoring every 60s

  tags = { Name = "${var.name_prefix}-aurora-instance-${count.index}" }
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
  alarm_description   = "Aurora CPU utilization exceeds 80%"
  dimensions          = { DBClusterIdentifier = aws_rds_cluster.aurora.cluster_identifier }
}
