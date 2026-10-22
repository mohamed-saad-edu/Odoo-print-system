#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
DEPLOY_DIR="$ROOT_DIR/deploy/domain-test"
ENV_FILE="$DEPLOY_DIR/.env.domain-test"
DOMAIN="${GATEWAY_DOMAIN:-print.yaseir.cloud}"

if [[ "$DOMAIN" != "print.yaseir.cloud" ]]; then
  echo "ERROR: this staging deployment is pinned to print.yaseir.cloud."
  exit 1
fi

command -v docker >/dev/null 2>&1 || { echo "ERROR: Docker is required."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "ERROR: Docker Compose v2 is required."; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "ERROR: openssl is required."; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "ERROR: curl is required."; exit 1; }

get_env_value() {
  local key="$1"
  local file="$2"
  [[ -f "$file" ]] || return 1
  grep -m1 "^${key}=" "$file" | cut -d= -f2-
}

# Upgrade an existing HTTPS staging environment in place. Never create
# a new database or replace a legacy volume while updating the branch.
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: Missing HTTPS staging environment; configure existing database secrets and volume." >&2
  exit 1
fi
upsert_env() {
  local key="$1" value="$2"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    sed -i "s#^${key}=.*#${key}=${value}#" "$ENV_FILE"
  else
    printf "%s=%s\n" "$key" "$value" >> "$ENV_FILE"
  fi
}
# One-time compatibility for an already deployed HTTPS staging server.
# The old HTTP listener and scripts are NOT started or needed.
OLD_VOLUME_KEY="$(get_env_value HTTP_TEST_VOLUME_NAME "$ENV_FILE" || true)"
if [[ -z "$(get_env_value STAGING_PG_VOLUME "$ENV_FILE" || true)" && -n "$OLD_VOLUME_KEY" ]]; then
  upsert_env STAGING_PG_VOLUME "$OLD_VOLUME_KEY"
fi
OLD_FIXTURE_MODE="$(get_env_value YASEIR_HTTP_TEST_MODE "$ENV_FILE" || true)"
if [[ -z "$(get_env_value YASEIR_STAGING_FIXTURES_ENABLED "$ENV_FILE" || true)" && "$OLD_FIXTURE_MODE" == "1" ]]; then
  upsert_env YASEIR_STAGING_FIXTURES_ENABLED 1
fi
# Remove obsolete HTTP test switches after their values have been migrated.
sed -i '/^HTTP_TEST_VOLUME_NAME=/d; /^YASEIR_HTTP_TEST_MODE=/d' "$ENV_FILE"
STAGING_PG_VOLUME="$(get_env_value STAGING_PG_VOLUME "$ENV_FILE" || true)"
if [[ -z "$STAGING_PG_VOLUME" ]] || ! docker volume inspect "$STAGING_PG_VOLUME" >/dev/null 2>&1; then
  echo "ERROR: Existing HTTPS staging PostgreSQL volume was not found; refusing data reset." >&2
  exit 1
fi
export STAGING_PG_VOLUME
# Fixture example values must NEVER become production-shaped staging secrets.
# Regenerate only explicit non-secret placeholders; preserve configured values.
for key in POSTGRES_PASSWORD GATEWAY_JWT_SECRET TRUST_PROXY_SECRET; do
  value="$(get_env_value "$key" "$ENV_FILE" || true)"
  if [[ "$value" == "generated-at-setup" ]]; then
    upsert_env "$key" "$(openssl rand -hex 32)"
  fi
done
DOMAIN_CADDY_ID="$(docker compose --env-file "$ENV_FILE" -f "$DEPLOY_DIR/docker-compose.yml" ps -q caddy 2>/dev/null || true)"
if [[ -z "$DOMAIN_CADDY_ID" ]] && command -v ss >/dev/null 2>&1; then
  for port in 80 443; do
    if ss -ltn 2>/dev/null | grep -qE "[:.]$port[[:space:]]*$"; then
      echo "ERROR: TCP port $port is already in use."
      echo "Stop the existing listener before starting domain staging."
      exit 1
    fi
  done
fi

POSTGRES_PASSWORD="$(get_env_value POSTGRES_PASSWORD "$ENV_FILE" || true)"
GATEWAY_JWT_SECRET="$(get_env_value GATEWAY_JWT_SECRET "$ENV_FILE" || true)"
TRUST_PROXY_SECRET="$(get_env_value TRUST_PROXY_SECRET "$ENV_FILE" || true)"
if [[ -z "$POSTGRES_PASSWORD" ]]; then POSTGRES_PASSWORD="$(openssl rand -hex 24)"; fi
if [[ -z "$GATEWAY_JWT_SECRET" ]]; then GATEWAY_JWT_SECRET="$(openssl rand -hex 32)"; fi
if [[ -z "$TRUST_PROXY_SECRET" ]]; then TRUST_PROXY_SECRET="$(openssl rand -hex 32)"; fi

ensure_env() {
  local key="$1" value="$2"
  if [[ -z "$(get_env_value "$key" "$ENV_FILE" || true)" ]]; then upsert_env "$key" "$value"; fi
}

ensure_env POSTGRES_DB yasser_http_test
ensure_env POSTGRES_USER yasser_test
upsert_env POSTGRES_PASSWORD "$POSTGRES_PASSWORD"
upsert_env GATEWAY_JWT_SECRET "$GATEWAY_JWT_SECRET"
upsert_env TRUST_PROXY_SECRET "$TRUST_PROXY_SECRET"
ensure_env PLATFORM_TENANT_ID http-test-platform
ensure_env MANAGER_USERNAME http-test-admin
ensure_env MANAGER_PASSWORD_HASH unused-in-https-staging
upsert_env GATEWAY_DOMAIN "$DOMAIN"
upsert_env APP_BASE_URL "https://$DOMAIN"
upsert_env COOKIE_SECURE 1
upsert_env TRUST_PROXY 1
upsert_env YASEIR_STAGING_FIXTURES_ENABLED 1
# Prevent accidental multi-tenant trial proliferation on shared HTTPS staging.
upsert_env YASEIR_STAGING_SINGLE_WORKSPACE 1
# Enable safe, isolated capture tests on staging, but preserve an explicit 0 opt-out.
ensure_env YASEIR_E2E_CAPTURE_ENABLED 1
# Continue using the same external PostgreSQL volume; NEVER delete/reset it.
upsert_env STAGING_PG_VOLUME "$STAGING_PG_VOLUME"
# These are STAGING-ONLY allowlisted pretend Stripe prices, not real Stripe
# products. Updating the stock one-price fixture preserves a custom operator
# catalog. The UI still requires the same exact Price ID/currency/interval.
LEGACY_STAGING_PRICE_CATALOG='[{"id":"http-test","name":"HTTP Test","priceId":"price_http_test_yasser","currency":"usd","interval":"month","entitlements":{"max_agents":5,"max_printers":10,"max_jobs_per_minute":60,"max_concurrent_jobs":8,"max_prints_per_period":"unlimited"}}]'
LEGACY_TWO_PRICE_CATALOG='[{"id":"http-test","name":"HTTP Test","priceId":"price_http_test_yasser","currency":"usd","interval":"month","entitlements":{"max_agents":5,"max_printers":10,"max_jobs_per_minute":60,"max_concurrent_jobs":8,"max_prints_per_period":"unlimited"}},{"id":"go","name":"Go","priceId":"price_go_yasser","currency":"usd","interval":"month","entitlements":{"max_agents":10,"max_printers":10,"max_jobs_per_minute":120,"max_concurrent_jobs":20,"max_prints_per_period":"unlimited"}}]'
DEFAULT_STAGING_PRICE_CATALOG='[{"id":"http-test","name":"Staging Trial","priceId":"price_http_test_yasser","currency":"usd","interval":"month","entitlements":{"max_agents":5,"max_printers":10,"max_jobs_per_minute":60,"max_concurrent_jobs":8,"max_prints_per_period":"unlimited"}},{"id":"go","name":"Go","priceId":"price_go_yasser","currency":"usd","interval":"month","entitlements":{"max_agents":10,"max_printers":10,"max_jobs_per_minute":120,"max_concurrent_jobs":20,"max_prints_per_period":"unlimited"}}]'
ensure_env STRIPE_PLAN_CATALOG "$DEFAULT_STAGING_PRICE_CATALOG"
if [[ "$(get_env_value STRIPE_PLAN_CATALOG "$ENV_FILE")" == "$LEGACY_STAGING_PRICE_CATALOG" || "$(get_env_value STRIPE_PLAN_CATALOG "$ENV_FILE")" == "$LEGACY_TWO_PRICE_CATALOG" ]]; then
  upsert_env STRIPE_PLAN_CATALOG "$DEFAULT_STAGING_PRICE_CATALOG"
fi
chmod 600 "$ENV_FILE"

# Build the security-patched local PostgreSQL and Caddy images before
# launching any dependent service. Reuses the existing external data volume.
docker compose --env-file "$ENV_FILE" -f "$DEPLOY_DIR/docker-compose.yml" build postgres caddy

# Prepare the schema and persist the domain binding before starting the Gateway.
# This never resets accounts, changes workspace ownership, or deletes volumes.
docker compose --env-file "$ENV_FILE" -f "$DEPLOY_DIR/docker-compose.yml" run --rm --build migrate
MANAGER_TENANT_ID="$(get_env_value MANAGER_TENANT_ID "$ENV_FILE" || true)"
PLATFORM_TENANT_ID="$(get_env_value PLATFORM_TENANT_ID "$ENV_FILE")"
docker compose --env-file "$ENV_FILE" -f "$DEPLOY_DIR/docker-compose.yml" exec -T postgres \
  sh -c 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 "$@"' sh \
  -v "domain=$DOMAIN" -v "manager_tenant_id=$MANAGER_TENANT_ID" \
  -v "platform_tenant_id=$PLATFORM_TENANT_ID" < "$DEPLOY_DIR/configure-domain.sql"

docker compose --env-file "$ENV_FILE" -f "$DEPLOY_DIR/docker-compose.yml" up -d --build

echo "Validating Caddy configuration..."
docker compose --env-file "$ENV_FILE" -f "$DEPLOY_DIR/docker-compose.yml" exec -T caddy caddy validate --config /etc/caddy/Caddyfile

echo "Waiting for HTTPS Gateway..."
for _ in $(seq 1 90); do
  if curl -fsS --max-time 15 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/live" >/dev/null 2>&1 && curl -fsS --max-time 15 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if ! curl -fsS --max-time 15 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/live" >/dev/null; then
  echo "ERROR: HTTPS /api/live is not reachable through Caddy."
  docker compose --env-file "$ENV_FILE" -f "$DEPLOY_DIR/docker-compose.yml" ps || true
  docker compose --env-file "$ENV_FILE" -f "$DEPLOY_DIR/docker-compose.yml" logs --no-color --tail=200 caddy gateway || true
  exit 1
fi
if ! curl -fsS --max-time 15 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/health" >/dev/null; then
  echo "ERROR: HTTPS /api/health is not ready."
  docker compose --env-file "$ENV_FILE" -f "$DEPLOY_DIR/docker-compose.yml" logs --no-color --tail=200 caddy gateway || true
  exit 1
fi

# An unauthenticated capture GET must return 401 when the route is deployed
# and the flag is enabled. 404 indicates a missing/disabled capture API.
# No integration API key or document payload is sent by this probe.
if [[ "$(get_env_value YASEIR_E2E_CAPTURE_ENABLED "$ENV_FILE" || true)" == "1" ]]; then
  echo "Checking staging E2E Capture API admission..."
  capture_status="$(curl -sS --max-time 15 --resolve "$DOMAIN:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$DOMAIN/api/odoo/test-captures" || true)"
  if [[ "$capture_status" != "401" ]]; then
    echo "ERROR: E2E Capture API expected HTTP 401 without credentials, got ${capture_status:-unreachable}." >&2
    echo "Check the staging Gateway image and YASEIR_E2E_CAPTURE_ENABLED=1; do not disable HTTPS." >&2
    exit 1
  fi
fi

docker compose --env-file "$ENV_FILE" -f "$DEPLOY_DIR/docker-compose.yml" run --rm gateway npm run db:provision-plans

echo
echo "Yaseir domain staging is READY."
echo "Gateway:    https://$DOMAIN"
echo "Signup:     https://$DOMAIN/signup"
echo "Login:      https://$DOMAIN/login"
echo "Odoo URL:   https://$DOMAIN"
echo "Agent WS:   wss://$DOMAIN/api/agent/ws"
echo "Env file:   $ENV_FILE"
