# ── SNS Topic for alerts ──────────────────────────────────────────────
resource "aws_sns_topic" "alerts" {
  name         = "${var.name_prefix}-alerts"
  display_name = "AquaSense Alert Notifications"
}

# ── SQS Dead-Letter Queue ─────────────────────────────────────────────
resource "aws_sqs_queue" "alert_dlq" {
  name                       = "${var.name_prefix}-alert-dlq"
  message_retention_seconds  = 1209600  # 14 days
  tags                       = { Name = "${var.name_prefix}-alert-dlq" }
}

# ── SQS Queue (alert processing) ──────────────────────────────────────
resource "aws_sqs_queue" "alert_queue" {
  name                       = "${var.name_prefix}-alert-queue"
  delay_seconds              = 0
  max_message_size           = 262144
  message_retention_seconds  = 86400  # 1 day
  receive_wait_time_seconds  = 20     # long polling
  visibility_timeout_seconds = 60

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.alert_dlq.arn
    maxReceiveCount     = 5
  })

  tags = { Name = "${var.name_prefix}-alert-queue" }
}

# ── SNS → SQS Subscription ───────────────────────────────────────────
resource "aws_sns_topic_subscription" "sqs" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "sqs"
  endpoint  = aws_sqs_queue.alert_queue.arn
}

# ── SQS Policy to allow SNS to send messages ─────────────────────────
resource "aws_sqs_queue_policy" "alert_queue" {
  queue_url = aws_sqs_queue.alert_queue.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "AllowSNSPublish"
      Effect = "Allow"
      Principal = { Service = "sns.amazonaws.com" }
      Action   = "sqs:SendMessage"
      Resource = aws_sqs_queue.alert_queue.arn
      Condition = { ArnEquals = { "aws:SourceArn" = aws_sns_topic.alerts.arn } }
    }]
  })
}
