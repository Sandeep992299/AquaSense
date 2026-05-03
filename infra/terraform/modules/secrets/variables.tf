variable "name_prefix"  { type = string }
variable "environment"  { type = string }
variable "db_password"  {
  type      = string
  sensitive = true
}
variable "jwt_secret"   {
  type      = string
  sensitive = true
}
