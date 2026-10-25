#!/usr/bin/env bash
# In-place HTTPS staging upgrade. No database/volume reset or automatic signup.
set -euo pipefail
umask 077
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
DEPLOY_DIR="$ROOT_DIR/deploy/domain-test"
ENV_FILE="$DEPLOY_DIR/.env.domain-test"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.yml"
DOMAIN=print.yaseir.cloud
command -v docker >/dev/null && docker compose version >/dev/null || { echo "Docker Compose v2 is required" >&2; exit 2; }
for utility in openssl sha256sum curl git; do command -v "$utility" >/dev/null || { echo "Missing $utility" >&2; exit 2; }; done
[[ -f "$ENV_FILE" ]] || { echo "Missing existing HTTPS staging env: $ENV_FILE (refusing new database)" >&2; exit 2; }
# Preserve the ORIGINAL configuration before this script mutates any key.
# An operator can restore it if a later preflight or migration stops safely.
BACKUP_DIR="$HOME/.local/share/yaseir-staging-backups"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ENV_BACKUP="$(mktemp "$BACKUP_DIR/before-v4-original-env-$STAMP.XXXXXX")"
cp "$ENV_FILE" "$ENV_BACKUP"
chmod 600 "$ENV_BACKUP"
echo "Original staging environment saved securely: $ENV_BACKUP"
get_env_value() { grep -m1 "^$1=" "$ENV_FILE" | cut -d= -f2- || true; }
upsert_env() {
  local key="$1" value="$2"
  if grep -q "^$key=" "$ENV_FILE"; then
    sed -i "s|^$key=.*|$key=$value|" "$ENV_FILE"
  else printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"; fi
}
ensure_env() { [[ -n "$(get_env_value "$1")" ]] || upsert_env "$1" "$2"; }
# Preserve the prior HTTPS staging volume and bootstrap identity.
old_volume="$(get_env_value STAGING_PG_VOLUME)"
[[ -n "$old_volume" ]] || old_volume="$(get_env_value HTTP_TEST_VOLUME_NAME)"
[[ -n "$old_volume" ]] || { echo "Missing STAGING_PG_VOLUME; refusing data loss" >&2; exit 2; }
docker volume inspect "$old_volume" >/dev/null || { echo "Existing staging DB volume not found: $old_volume" >&2; exit 2; }
upsert_env STAGING_PG_VOLUME "$old_volume"
[[ "$(get_env_value POSTGRES_DB)" == yasser_http_test ]] || { echo "Unexpected DB name; refusing migration" >&2; exit 2; }
[[ -n "$(get_env_value POSTGRES_USER)" ]] || { echo "Existing bootstrap user is required" >&2; exit 2; }
[[ "$(get_env_value GATEWAY_DOMAIN)" == "$DOMAIN" ]] || { echo "Staging domain mismatch" >&2; exit 2; }
[[ "$(get_env_value APP_BASE_URL)" == "https://$DOMAIN" ]] || { echo "Staging must use its pinned HTTPS origin" >&2; exit 2; }
bootstrap="$(get_env_value POSTGRES_PASSWORD)"
[[ ${#bootstrap} -ge 32 && "$bootstrap" != generated-at-setup ]] || {
  echo "Existing PostgreSQL bootstrap password is missing/too short; rotate it in the existing DB and env manually first" >&2
  exit 2
}
ensure_env POSTGRES_OWNER_USER yaseir_owner
ensure_env POSTGRES_RUNTIME_USER yaseir_runtime
ensure_env STAGING_ROLE_STATE_VOLUME yaseir_domain_test_role_state
for key in POSTGRES_OWNER_PASSWORD POSTGRES_RUNTIME_PASSWORD GATEWAY_JWT_SECRET TRUST_PROXY_SECRET; do
  value="$(get_env_value "$key")"
  if [[ -z "$value" || "$value" == generated-at-setup ]]; then
    upsert_env "$key" "$(openssl rand -hex 32)"
  fi
done
owner_secret="$(get_env_value POSTGRES_OWNER_PASSWORD)"
runtime_secret="$(get_env_value POSTGRES_RUNTIME_PASSWORD)"
[[ ${#owner_secret} -ge 32 && ${#runtime_secret} -ge 32 && "$owner_secret" != "$runtime_secret" && "$owner_secret" != "$bootstrap" && "$runtime_secret" != "$bootstrap" ]] || { echo "Database secrets must be 3 independent values >=32 characters" >&2; exit 2; }
ensure_env MANAGER_USERNAME http-test-admin
ensure_env MANAGER_PASSWORD_HASH unused-in-https-staging
ensure_env PLATFORM_TENANT_ID http-test-platform
upsert_env COOKIE_SECURE 1
upsert_env TRUST_PROXY 1
upsert_env YASEIR_STAGING_FIXTURES_ENABLED 1
upsert_env YASEIR_STAGING_SINGLE_WORKSPACE 1
upsert_env YASEIR_DEPLOYMENT_ID "$(git rev-parse HEAD)"
# Old STRIPE_PLAN_CATALOG is intentionally NOT forwarded by the V4 Gateway.
# Manual plans only: provisioning a plan never activates a customer.
DEFAULT_MANUAL_PLANS='[{"id":"http-test","name":"Staging Manual","description":"Staging-only plan; owner activation required","monthlyQuota":1000},{"id":"go","name":"Go","description":"Staging manual plan","monthlyQuota":2000}]'
ensure_env YASEIR_PLAN_CATALOG "$DEFAULT_MANUAL_PLANS"
chmod 600 "$ENV_FILE"
compose() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }
compose config --quiet
cid="$(compose ps -q postgres 2>/dev/null || true)"
[[ -n "$cid" ]] || { echo "Existing staging PostgreSQL must be running for a verified pre-upgrade backup; no new cluster will be created" >&2; exit 2; }
# Verify that we are talking to the SAME database before any service update.
current_db="$(compose exec -T postgres sh -c 'psql -X -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "select current_database()"' | tr -d '\r\n')"
[[ "$current_db" == yasser_http_test ]] || { echo "Unexpected connected database" >&2; exit 2; }
ARCHIVE="$(mktemp "$BACKUP_DIR/before-v4-$STAMP.XXXXXX.dump")"
echo "Backing up existing database before V4 role and schema migrations..."
compose exec -T postgres sh -c 'exec pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$ARCHIVE"
[[ -s "$ARCHIVE" ]] || { echo "Backup empty; refusing upgrade" >&2; exit 1; }
compose exec -T postgres sh -c 'exec pg_restore --list' < "$ARCHIVE" >/dev/null
(cd "$BACKUP_DIR" && sha256sum "$(basename "$ARCHIVE")" > "$(basename "$ARCHIVE").sha256")
echo "Verified private backup: $ARCHIVE"
echo "Stopping ONLY staging Gateway before applying least-privilege database roles..."
compose stop gateway || true
compose build postgres caddy gateway database_roles migrate database_verify
compose up -d postgres
compose up --no-deps database_roles
compose up --no-deps migrate
compose up --no-deps database_verify
# Domain ownership is bound by trusted SQL after migrations, before Gateway.
compose exec -T postgres sh -c 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 "$@"' sh \
  -v "domain=$DOMAIN" -v "manager_tenant_id=$(get_env_value MANAGER_TENANT_ID)" \
  -v "platform_tenant_id=$(get_env_value PLATFORM_TENANT_ID)" < "$DEPLOY_DIR/configure-domain.sql"
# Upgrade old named Caddy TLS volumes to main's unprivileged 10001 UID.
compose run --rm --no-deps --user 0:0 --cap-add CHOWN --entrypoint /bin/sh caddy \
  -ec 'chown -R 10001:10001 /data /config && chmod 0700 /data /config'
compose up -d --no-deps gateway caddy
compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile
ready=0
for _ in $(seq 1 90); do
  if curl -fsS --max-time 15 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/live" >/dev/null 2>&1 && \
     curl -fsS --max-time 15 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/health" >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[[ "$ready" == 1 ]] || { echo "Staging HTTPS checks failed; original volume/backups are preserved" >&2; compose ps; exit 1; }
compose run --rm --no-deps gateway node --import tsx scripts/provision-plans.ts
echo "HTTPS staging updated in place: https://$DOMAIN"
echo "No database reset, self-signup, billing activation, or production deployment performed."
echo "Manual subscription approval is performed by the Platform Owner."
echo "Original database volume: $old_volume"
echo "Protected pre-upgrade backup: $ARCHIVE"
