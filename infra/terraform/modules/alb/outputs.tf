output "alb_dns_name"        { value = aws_lb.main.dns_name }
output "alb_arn"             { value = aws_lb.main.arn }
output "target_group_arns"   {
  description = "Map of service-name => target group ARN"
  value       = { for k, v in aws_lb_target_group.services : k => v.arn }
}
