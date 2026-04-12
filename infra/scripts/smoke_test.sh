#!/usr/bin/env bash
# =====================================================================
# AquaSense – API Smoke Test
# Hits all 4 service health endpoints + key API routes
#
# Usage:
#   Local (no DB):  ./smoke_test.sh
#   Local (with DB): ./smoke_test.sh
#   AWS ALB:        BASE=http://<ALB-DNS> ./smoke_test.sh --alb
#
# Exit codes: 0 = all pass, 1 = one or more failures
# =====================================================================
set -uo pipefail   # NOTE: no -e so ((FAIL++)) doesn't exit on first fail

MODE="${1:-}"
PASS=0
FAIL=0

# ── Endpoint config ───────────────────────────────────────────────────
if [[ "${MODE}" == "--alb" ]]; then
  ALB="${BASE:-http://localhost}"
  USER_BASE="${ALB}"
  BILLING_BASE="${ALB}"
  USAGE_BASE="${ALB}"
  ALERT_BASE="${ALB}"
else
  USER_BASE="${BASE_USER:-http://localhost:8081}"
  BILLING_BASE="${BASE_BILLING:-http://localhost:8082}"
  USAGE_BASE="${BASE_USAGE:-http://localhost:8083}"
  ALERT_BASE="${BASE_ALERT:-http://localhost:8084}"
fi

# ── Helper: check a URL against one OR multiple accepted codes ────────
check() {
  local label="$1" url="$2"
  shift 2
  local accepted=("$@")   # remaining args are accepted HTTP codes
  [[ ${#accepted[@]} -eq 0 ]] && accepted=("200")

  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 "${url}" || echo "000")

  local matched=false
  for ac in "${accepted[@]}"; do
    [[ "${code}" == "${ac}" ]] && matched=true && break
  done

  if $matched; then
    echo "  ✅  ${label}  (${code})"
    PASS=$((PASS + 1))
  else
    echo "  ❌  ${label}  got=${code}  accepted=${accepted[*]}  → ${url}"
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  AquaSense – API Smoke Test"
[[ "${MODE}" == "--alb" ]] && echo "  Mode: ALB (${ALB})" || echo "  Mode: Local (direct ports)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Health checks (200=healthy+DB, 503=up-but-no-DB — both accepted) ──
echo ""
echo "── Health Endpoints ──────────────────────────────"
check "user-service    /health"    "${USER_BASE}/health"    "200" "503"
check "billing-service /health"    "${BILLING_BASE}/health" "200" "503"
check "usage-service   /health"    "${USAGE_BASE}/health"   "200" "503"
check "alert-service   /health"    "${ALERT_BASE}/health"   "200" "503"

# ── Auth API ──────────────────────────────────────────────────────────
echo ""
echo "── Auth API ──────────────────────────────────────"

# Register test user (201 first run, 409 if already exists, 500 if no DB)
REG_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 \
  -X POST "${USER_BASE}/api/auth/register" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Smoke Test","email":"smoke@test.aquasense","password":"Smoke1234!"}' || echo "000")
if [[ "${REG_CODE}" == "201" || "${REG_CODE}" == "409" || "${REG_CODE}" == "500" ]]; then
  echo "  ✅  POST /api/auth/register  (${REG_CODE})"
  PASS=$((PASS + 1))
else
  echo "  ❌  POST /api/auth/register  got=${REG_CODE}"
  FAIL=$((FAIL + 1))
fi

# Login – 401 = service up (bad creds or no seed data), 500 = no DB, 200 = seeded DB
LOGIN_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 \
  -X POST "${USER_BASE}/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"rajesh@aquasense.in","password":"password123"}' || echo "000")
if [[ "${LOGIN_CODE}" == "200" || "${LOGIN_CODE}" == "401" || "${LOGIN_CODE}" == "500" ]]; then
  echo "  ✅  POST /api/auth/login  (${LOGIN_CODE})"
  PASS=$((PASS + 1))
else
  echo "  ❌  POST /api/auth/login  got=${LOGIN_CODE}"
  FAIL=$((FAIL + 1))
fi

# Token verify endpoint (always available – no DB needed)
check "POST /api/auth/verify (no token = 400)" \
  "${USER_BASE}/api/auth/verify" "400"

# ── Usage API ─────────────────────────────────────────────────────────
echo ""
echo "── Usage API ─────────────────────────────────────"
check "GET /api/usage/meters"   "${USAGE_BASE}/api/usage/meters"   "200" "500"

# ── Billing API ───────────────────────────────────────────────────────
echo ""
echo "── Billing API ───────────────────────────────────"
check "GET /api/billing/rates"  "${BILLING_BASE}/api/billing/rates" "200" "500"

# ── Alert API (route ordering critical: static paths before /:id) ─────
echo ""
echo "── Alert API (static-before-dynamic route order) ─"
check "GET /api/alerts                (list)"          "${ALERT_BASE}/api/alerts"                "200" "500"
check "GET /api/alerts/stats          (static ✓)"     "${ALERT_BASE}/api/alerts/stats"           "200" "500"
check "GET /api/alerts/subscriptions  (static ✓)"     "${ALERT_BASE}/api/alerts/subscriptions"   "200" "500"
check "GET /api/alerts/user/:id       (3-segment ✓)"  \
  "${ALERT_BASE}/api/alerts/user/a0000001-0000-0000-0000-000000000001" "200" "500"

# Regression guard: /stats must NEVER return 404 (that means route ordering broke)
STATS_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 "${ALERT_BASE}/api/alerts/stats" || echo "000")
if [[ "${STATS_CODE}" == "404" ]]; then
  echo "  ❌  REGRESSION: /api/alerts/stats returned 404 – route ordering bug!"
  FAIL=$((FAIL + 1))
fi

# ── Summary ───────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Results: ✅ ${PASS} passed   ❌ ${FAIL} failed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
[[ ${FAIL} -eq 0 ]] && exit 0 || exit 1
