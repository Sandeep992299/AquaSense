output "cluster_endpoint" { value = aws_rds_cluster.aurora.endpoint }
output "reader_endpoint"  { value = aws_rds_cluster.aurora.reader_endpoint }
output "cluster_id"       { value = aws_rds_cluster.aurora.cluster_identifier }
output "database_name"    { value = aws_rds_cluster.aurora.database_name }
