# Yaseir HTTPS staging (V4-compatible)

**Branch:** `test/http-server-ready`. **Origin:** `https://print.yaseir.cloud`.

The staging deployment carries the same V4 application, migrations, DB role isolation, secure Caddy and password-only authentication as main, plus only three fenced staging features: **one customer workspace**, email capture instead of Resend on this exact HTTPS origin, and a manual test plan catalog. Invitations to the existing company workspace remain accepted. This is not the production compose configuration.

## Existing server upgrade (no data reset)

Never overwrite the existing `deploy/domain-test/.env.domain-test` or remove its external `STAGING_PG_VOLUME`. The setup script refuses an absent volume, changed database name, or missing running PostgreSQL. It creates a protected **original environment backup before changing any key**, then a private verified PostgreSQL backup before role/migration changes. It builds the V4 PostgreSQL, Caddy, Gateway and migration images **sequentially** (one service at a time) while the existing Gateway stays online. Only after every build succeeds does it stop the old staging Gateway for the DB-role cutover. It does not invoke reset or remove Docker volumes.

```bash
cd /opt/yasser
git status --short
git fetch origin
git switch test/http-server-ready
git pull --ff-only origin test/http-server-ready
bash -n deploy/domain-test/setup-domain-test.sh
# The setup prepares new owner/runtime credentials and validates Compose
# itself. Do not run Compose config against the old .env beforehand.
bash deploy/domain-test/setup-domain-test.sh
docker compose --env-file deploy/domain-test/.env.domain-test -f deploy/domain-test/docker-compose.yml config --quiet
bash deploy/domain-test/smoke-domain-test.sh
```

**Before the setup:** check `free -h`, `swapon --show`, `nproc`, `df -h /` and verify free disk for a verified PG dump and Docker builds. Do NOT manually run `docker compose ... build postgres caddy gateway database_roles migrate database_verify` as one concurrent multi-service build on a small VM. The setup script deliberately builds sequentially; preserve a separate VM/snapshot backup; confirm that no unrelated databases/roles live in the staging PostgreSQL cluster. The V4 role-profile intentionally refuses shared database clusters or live Gateway clients. Only the existing staging DB/volume is targeted. No automatic rollback of forward-only migrations is promised.

The script creates the independent `POSTGRES_OWNER_PASSWORD` and `POSTGRES_RUNTIME_PASSWORD` once if missing. It never silently changes the existing bootstrap `POSTGRES_PASSWORD`; a missing or short bootstrap credential must be rotated in the actual PostgreSQL cluster **and** env by an operator before the upgrade. Preserve secrets, Caddy TLS volumes and the DB role state volume across updates.

## Subscription changes

V4 retired the earlier fake Stripe trial/checkout flow. The `YASEIR_PLAN_CATALOG` sample bootstraps **manual plans only**; it **does not** grant or extend any customer subscription. Existing billing history and legacy provider metadata are kept by the V4 cutover migration. A Platform Owner must activate/renew each customer subscription using the new auditable manual subscription UI. Do not run the old `renew-expired-trial.sql`; it fails closed. The old workspace-reset command is disabled for V4 until independently reviewed.

## HTTPS and workspace safety

Gateway is private on port 3000, reachable through unprivileged Caddy at 80/443. Caddy forwards the signed proxy token and overwrites `X-Forwarded-For`. The Gateway uses only the restricted runtime PostgreSQL role; the role-profile and migrator have separate credentials. No MFA or insecure HTTP toggles are introduced.

Only on the exact origin `https://print.yaseir.cloud` with BOTH fixture toggles enabled can the first verified signup create a workspace. Later signups are refused, while verified invitations can join the existing company workspace. If Resend is not configured, verification links are captured in the **private Gateway container** at `/tmp/yaseir-domain-test-verification-email.txt`. Treat the captured links as credentials; never publish them or add the file to Git.

## Checks and limitations

GitHub staging CI validates the real V4 code, schema integration, the stage Compose security topology and the isolated domain-binding SQL. CI cannot see your Azure VM's actual live volume, active TLS or Odoo customer databases. Final readiness for updating the server requires the operator to run the scripts above, inspect HTTPS liveness/readiness and review migration logs. This operation intentionally never deploys itself.
