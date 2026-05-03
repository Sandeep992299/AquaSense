resource "aws_secretsmanager_secret" "db_password" {
  name                    = "${var.name_prefix}/${var.environment}/db-password"
  description             = "AquaSense Aurora master password"
  recovery_window_in_days = 7
}
resource "aws_secretsmanager_secret_version" "db_password" {
  secret_id     = aws_secretsmanager_secret.db_password.id
  secret_string = var.db_password
}

resource "aws_secretsmanager_secret" "jwt_secret" {
  name                    = "${var.name_prefix}/${var.environment}/jwt-secret"
  description             = "AquaSense JWT signing secret"
  recovery_window_in_days = 7
}
resource "aws_secretsmanager_secret_version" "jwt_secret" {
  secret_id     = aws_secretsmanager_secret.jwt_secret.id
  secret_string = var.jwt_secret
}
