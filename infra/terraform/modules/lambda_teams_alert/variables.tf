variable "name_prefix" {
  description = "Resource name prefix (e.g. tf-AquaSense-prod)"
  type        = string
}

variable "environment" {
  description = "Deployment environment (prod / staging / dev)"
  type        = string
  default     = "prod"
}

variable "lambda_zip_path" {
  description = "Absolute local path to the Lambda deployment ZIP created by package.ps1"
  type        = string
}

variable "sns_topic_arn" {
  description = "ARN of the existing AquaSense SNS alert topic"
  type        = string
}

variable "sqs_alert_queue_arn" {
  description = "ARN of the existing AquaSense SQS alert queue"
  type        = string
}

variable "teams_webhook_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the Teams webhook URL"
  type        = string
}

variable "teams_webhook_secret_name" {
  description = "Name of the Secrets Manager secret (e.g. aquasense/teams-webhook)"
  type        = string
  default     = "aquasense/teams-webhook"
}
