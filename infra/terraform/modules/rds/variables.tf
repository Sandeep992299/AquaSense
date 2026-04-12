variable "name_prefix"          { type = string }
variable "db_subnet_group_name" { type = string }
variable "rds_sg_id"            { type = string }
variable "db_password"          { type = string; sensitive = true }
variable "db_instance_class"    { type = string; default = "db.t3.medium" }
variable "environment"          { type = string }
