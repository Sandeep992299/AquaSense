# =====================================================================
# AquaSense – Lambda: teams-alert-notifier
# Terraform Module  (infra/terraform/modules/lambda_teams_alert)
# =====================================================================

# ── IAM Role for the Lambda ──────────────────────────────────────────
resource "aws_iam_role" "teams_alert_lambda" {
  name = "${var.name_prefix}-teams-alert-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = { Name = "${var.name_prefix}-teams-alert-lambda-role" }
}

resource "aws_iam_role_policy" "teams_alert_lambda" {
  name = "${var.name_prefix}-teams-alert-lambda-policy"
  role = aws_iam_role.teams_alert_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # CloudWatch Logs
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      },
      # Read the Teams webhook secret
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = var.teams_webhook_secret_arn
      },
      # Consume SQS messages
      {
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:ChangeMessageVisibility"
        ]
        Resource = var.sqs_alert_queue_arn
      },
      # Dead-Letter Queue write
      {
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = aws_sqs_queue.teams_alert_dlq.arn
      }
    ]
  })
}

# ── Dead-Letter Queue ────────────────────────────────────────────────
resource "aws_sqs_queue" "teams_alert_dlq" {
  name                      = "${var.name_prefix}-teams-alert-dlq"
  message_retention_seconds = 1209600   # 14 days
  tags                      = { Name = "${var.name_prefix}-teams-alert-dlq" }
}

# ── Lambda function ──────────────────────────────────────────────────
resource "aws_lambda_function" "teams_alert" {
  function_name = "${var.name_prefix}-teams-alert-notifier"
  role          = aws_iam_role.teams_alert_lambda.arn
  runtime       = "python3.12"
  handler       = "lambda_function.lambda_handler"
  timeout       = 30
  memory_size   = 128

  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)

  dead_letter_config {
    target_arn = aws_sqs_queue.teams_alert_dlq.arn
  }

  environment {
    variables = {
      TEAMS_WEBHOOK_SECRET_NAME = var.teams_webhook_secret_name
      ENVIRONMENT               = var.environment
      PROJECT_NAME              = "AquaSense"
    }
  }

  tags = { Name = "${var.name_prefix}-teams-alert-notifier" }
}

# ── CloudWatch Log Group ─────────────────────────────────────────────
resource "aws_cloudwatch_log_group" "teams_alert" {
  name              = "/aws/lambda/${aws_lambda_function.teams_alert.function_name}"
  retention_in_days = 30
  tags              = { Name = "${var.name_prefix}-teams-alert-logs" }
}

# ── SNS → Lambda subscription ────────────────────────────────────────
resource "aws_lambda_permission" "sns_invoke" {
  statement_id  = "AllowSNSInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.teams_alert.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = var.sns_topic_arn
}

resource "aws_sns_topic_subscription" "teams_alert" {
  topic_arn = var.sns_topic_arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.teams_alert.arn
}

# ── SQS → Lambda event-source mapping ───────────────────────────────
resource "aws_lambda_event_source_mapping" "sqs_trigger" {
  event_source_arn                   = var.sqs_alert_queue_arn
  function_name                      = aws_lambda_function.teams_alert.arn
  batch_size                         = 5
  maximum_batching_window_in_seconds = 10
  bisect_batch_on_function_error     = true

  function_response_types = ["ReportBatchItemFailures"]

  depends_on = [aws_iam_role_policy.teams_alert_lambda]
}
