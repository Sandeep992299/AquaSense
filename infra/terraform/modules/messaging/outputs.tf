output "sns_topic_arn"   { value = aws_sns_topic.alerts.arn }
output "sqs_queue_url"   { value = aws_sqs_queue.alert_queue.id }
output "sqs_queue_arn"   { value = aws_sqs_queue.alert_queue.arn }
output "sqs_dlq_arn"     { value = aws_sqs_queue.alert_dlq.arn }
