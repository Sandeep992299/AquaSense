output "db_password_secret_arn" { value = aws_secretsmanager_secret.db_password.arn }
output "jwt_secret_arn"         { value = aws_secretsmanager_secret.jwt_secret.arn }
