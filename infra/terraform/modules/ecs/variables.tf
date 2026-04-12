variable "name_prefix"            { type = string }
variable "vpc_id"                  { type = string }
variable "private_subnet_ids"      { type = list(string) }
variable "ecs_sg_id"               { type = string }
variable "execution_role_arn"      { type = string }
variable "task_role_arn"           { type = string }
variable "ecr_image_uris"          { type = map(string) }
variable "db_host"                 { type = string }
variable "db_password_secret_arn"  { type = string }
variable "jwt_secret_arn"          { type = string }
variable "alb_target_group_arns"   { type = map(string) }
variable "sns_topic_arn"           { type = string }
variable "sqs_queue_url"           { type = string }
variable "environment"             { type = string }
variable "service_desired_count"   { type = number; default = 2 }
variable "task_cpu"                { type = number; default = 512 }
variable "task_memory"             { type = number; default = 1024 }
