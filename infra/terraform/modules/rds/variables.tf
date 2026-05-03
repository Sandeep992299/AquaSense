variable "name_prefix"          { type = string }
variable "db_subnet_group_name" { type = string }
variable "rds_sg_id"            { type = string }
variable "db_password"          {
  type      = string
  sensitive = true
}
variable "db_instance_class"    {
  type    = string
  default = "db.t3.micro"
}
variable "db_name" {
  type    = string
  default = "aquasense_db"
}
variable "backup_retention_period" {
  type    = number
  default = 1
}
variable "environment"          { type = string }
