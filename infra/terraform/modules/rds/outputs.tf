output "cluster_endpoint" { value = aws_db_instance.postgres.endpoint }
output "reader_endpoint"  { value = "" }
output "cluster_id"       { value = aws_db_instance.postgres.id }
output "database_name"    { value = aws_db_instance.postgres.db_name }
