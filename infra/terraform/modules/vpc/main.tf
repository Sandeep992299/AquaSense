# ── VPC ──────────────────────────────────────────────────────────────
resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags = { Name = "${var.name_prefix}-vpc" }
}

# ── Public Subnets ────────────────────────────────────────────────────
resource "aws_subnet" "public" {
  count                   = length(var.azs)
  vpc_id                  = aws_vpc.main.id
  cidr_block              = var.public_subnet_cidrs[count.index]
  availability_zone       = var.azs[count.index]
  map_public_ip_on_launch = true
  tags = { Name = "${var.name_prefix}-public-${var.azs[count.index]}" }
}

# ── Private Subnets (ECS tasks) ───────────────────────────────────────
resource "aws_subnet" "private" {
  count             = length(var.azs)
  vpc_id            = aws_vpc.main.id
  cidr_block        = var.private_subnet_cidrs[count.index]
  availability_zone = var.azs[count.index]
  tags = { Name = "${var.name_prefix}-private-${var.azs[count.index]}" }
}

# ── DB Subnets (Aurora) ───────────────────────────────────────────────
resource "aws_subnet" "db" {
  count             = length(var.azs)
  vpc_id            = aws_vpc.main.id
  cidr_block        = var.db_subnet_cidrs[count.index]
  availability_zone = var.azs[count.index]
  tags = { Name = "${var.name_prefix}-db-${var.azs[count.index]}" }
}

# ── Internet Gateway ──────────────────────────────────────────────────
resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${var.name_prefix}-igw" }
}

# ── Elastic IPs for NAT Gateways ──────────────────────────────────────
resource "aws_eip" "nat" {
  count  = length(var.azs)
  domain = "vpc"
  tags   = { Name = "${var.name_prefix}-nat-eip-${count.index}" }
}

# ── NAT Gateways (one per AZ for HA) ─────────────────────────────────
resource "aws_nat_gateway" "nat" {
  count         = length(var.azs)
  subnet_id     = aws_subnet.public[count.index].id
  allocation_id = aws_eip.nat[count.index].id
  tags          = { Name = "${var.name_prefix}-nat-${var.azs[count.index]}" }
  depends_on    = [aws_internet_gateway.igw]
}

# ── Public Route Table ────────────────────────────────────────────────
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route { cidr_block = "0.0.0.0/0"; gateway_id = aws_internet_gateway.igw.id }
  tags = { Name = "${var.name_prefix}-public-rt" }
}
resource "aws_route_table_association" "public" {
  count          = length(var.azs)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# ── Private Route Tables (one per AZ, natted) ─────────────────────────
resource "aws_route_table" "private" {
  count  = length(var.azs)
  vpc_id = aws_vpc.main.id
  route { cidr_block = "0.0.0.0/0"; nat_gateway_id = aws_nat_gateway.nat[count.index].id }
  tags = { Name = "${var.name_prefix}-private-rt-${var.azs[count.index]}" }
}
resource "aws_route_table_association" "private" {
  count          = length(var.azs)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

# ── DB Subnet Group ───────────────────────────────────────────────────
resource "aws_db_subnet_group" "aurora" {
  name        = "${var.name_prefix}-aurora-subnet-group"
  description = "Aurora subnet group for AquaSense"
  subnet_ids  = aws_subnet.db[*].id
  tags        = { Name = "${var.name_prefix}-aurora-subnet-group" }
}
