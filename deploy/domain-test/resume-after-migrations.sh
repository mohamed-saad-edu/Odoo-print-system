#!/usr/bin/env bash
# Resume ONLY a V4 cutover whose role application, schema migration and
# restricted-runtime verification all exited successfully.
set -euo pipefail
umask 077
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
ENV_FILE="$ROOT_DIR/deploy/domain-test/.env.domain-test"
COMPOSE_FILE="$ROOT_DIR/deploy/domain-test/docker-compose.yml"
DOMAIN=print.yaseir.cloud
[[ -f "$ENV_FILE" ]] || { echo "Existing staging environment is missing; aborting" >&2; exit 2; }
compose() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }
compose config --quiet
for service in database_roles migrate database_verify; do
  cid="$(compose ps -a -q "$service")"
  [[ -n "$cid" ]] || { echo "No completed $service container: aborting" >&2; exit 2; }
  state="$(docker inspect --format '{{.State.Status}}:{{.State.ExitCode}}' "$cid")"
  [[ "$state" == exited:0 ]] || { echo "$service did not pass: $state; aborting" >&2; exit 2; }
done
pgcid="$(compose ps -q postgres)"
[[ -n "$pgcid" ]] || { echo "Existing PostgreSQL container not running; aborting" >&2; exit 2; }
pghealth="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$pgcid")"
[[ "$pghealth" == healthy ]] || { echo "PostgreSQL not healthy: $pghealth; aborting" >&2; exit 2; }
echo "V4 migrations passed. Repairing existing Caddy TLS volume ownership only..."
compose run --rm --no-deps --user 0:0 \
  --cap-add CHOWN --cap-add FOWNER --cap-add DAC_OVERRIDE \
  --entrypoint /bin/sh caddy \
  -ec 'chmod 0700 /data /config && chown -R 10001:10001 /data /config'
echo "Starting Gateway with restricted runtime PostgreSQL credentials..."
compose up -d --no-deps gateway
echo "Starting HTTPS Caddy with existing TLS volumes..."
compose up -d --no-deps caddy
compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile
ready=0
for _ in $(seq 1 60); do
  if curl -fsS --max-time 8 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/live" >/dev/null 2>&1 && \
     curl -fsS --max-time 8 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/health" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 3
done
if [[ "$ready" != 1 ]]; then
  echo "HTTPS is not ready. Database and TLS volumes were NOT reset." >&2
  compose ps
  compose logs --tail=60 gateway caddy >&2
  exit 1
fi
echo "HTTPS staging recovered. No DB migrations rerun."
compose ps
