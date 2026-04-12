#!/usr/bin/env bash
# =====================================================================
# AquaSense – Run DB migrations against Aurora
# Applies schema.sql + seed.sql via a temporary bastion or
# from a machine with network access to the Aurora cluster.
#
# For AWS: the Aurora cluster is in a private subnet.
# Options to run this script:
#   A) From an AWS Cloud9 instance inside the VPC
#   B) Via SSM Session Manager (no bastion needed)
#   C) Via a one-off ECS Fargate task (recommended for CI/CD)
#
# Prerequisites:
#   - psql installed
#   - DB_HOST, DB_USER, DB_PASSWORD, DB_NAME env vars set
#     OR: supply aurora_endpoint from terraform output
# =====================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SCHEMA_FILE="${REPO_ROOT}/services/db/schema.sql"
SEED_FILE="${REPO_ROOT}/services/db/seed.sql"

# ── Config (override via env vars or edit here) ───────────────────────
DB_HOST="${DB_HOST:-$(cd "${REPO_ROOT}/infra/terraform" && terraform output -raw aurora_cluster_endpoint 2>/dev/null || echo 'localhost')}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-aquasense_db}"
DB_USER="${DB_USER:-aqua_admin}"
# DB_PASSWORD must be in the environment: export DB_PASSWORD=...

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  AquaSense – Database Migration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Host : ${DB_HOST}:${DB_PORT}"
echo "  DB   : ${DB_NAME}"
echo "  User : ${DB_USER}"
echo ""

if [[ -z "${DB_PASSWORD:-}" ]]; then
  echo "ERROR: DB_PASSWORD environment variable not set."
  echo "Run:   export DB_PASSWORD='<your-password>'"
  exit 1
fi

export PGPASSWORD="${DB_PASSWORD}"

# ── Test connection ───────────────────────────────────────────────────
echo "▶ Testing database connection..."
psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d postgres -c "SELECT version();" > /dev/null
echo "✅ Connection OK"
echo ""

# ── Create database if not exists ────────────────────────────────────
echo "▶ Ensuring database '${DB_NAME}' exists..."
psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d postgres \
  -c "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" \
  | grep -q 1 || \
  psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d postgres \
  -c "CREATE DATABASE ${DB_NAME};"
echo "✅ Database ready"
echo ""

# ── Apply schema ──────────────────────────────────────────────────────
echo "▶ Applying schema.sql..."
psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
  --set ON_ERROR_STOP=1 \
  -f "${SCHEMA_FILE}"
echo "✅ Schema applied"
echo ""

# ── Apply seed data ───────────────────────────────────────────────────
read -rp "▶ Apply seed data (demo data)? [y/N] " CONFIRM
if [[ "${CONFIRM}" =~ ^[Yy]$ ]]; then
  psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
    --set ON_ERROR_STOP=1 \
    -f "${SEED_FILE}"
  echo "✅ Seed data applied"
else
  echo "⏭  Seed data skipped"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Migration complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

unset PGPASSWORD
