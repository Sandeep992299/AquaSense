output "lambda_function_name" {
  description = "Name of the teams-alert Lambda function"
  value       = aws_lambda_function.teams_alert.function_name
}

output "lambda_function_arn" {
  description = "ARN of the teams-alert Lambda function"
  value       = aws_lambda_function.teams_alert.arn
}

output "dlq_url" {
  description = "URL of the Dead-Letter Queue for failed alert deliveries"
  value       = aws_sqs_queue.teams_alert_dlq.url
}

output "dlq_arn" {
  description = "ARN of the Dead-Letter Queue"
  value       = aws_sqs_queue.teams_alert_dlq.arn
}

output "log_group_name" {
  description = "CloudWatch log group for the Lambda function"
  value       = aws_cloudwatch_log_group.teams_alert.name
}
