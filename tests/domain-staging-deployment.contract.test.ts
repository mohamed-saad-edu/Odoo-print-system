import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const read = (path: string) => readFileSync(path, "utf8");
describe("V4 HTTPS staging upgrade safety", () => {
  it("preserves the existing staging volume and does not expose Gateway directly", () => {
    const c = read("deploy/domain-test/docker-compose.yml");
    expect(c).toContain("staging_pg_data:");
    expect(c).toContain("external: true");
    expect(c).toContain("STAGING_PG_VOLUME");
    expect(c.split("\n  caddy:")[0].split("\n  gateway:")[1]).not.toContain("ports:");
    expect(c).toContain('user: "10001:10001"');
    expect(c).toContain("database_roles:");
    expect(c).toContain("database_verify:");
  });
  it("does not grant the Gateway elevated database credentials", () => {
    const c = read("deploy/domain-test/docker-compose.yml");
    const gateway = c.split("\n  caddy:")[0].split("\n  gateway:")[1];
    expect(gateway).toContain("postgres_runtime_password");
    expect(gateway).not.toContain("postgres_owner_password");
    expect(gateway).not.toContain("- postgres_password");
    expect(c).toContain("POSTGRES_OWNER_PASSWORD_FILE");
    expect(c).toContain("POSTGRES_RUNTIME_PASSWORD_FILE");
  });
  it("backs up old data and guards forward-only schema migration", () => {
    const s = read("deploy/domain-test/setup-domain-test.sh");
    expect(spawnSync("bash", ["-n", "deploy/domain-test/setup-domain-test.sh"]).status).toBe(0);
    for(const required of ["docker volume inspect", "pg_dump -Fc", "pg_restore --list", "sha256sum", "up --no-deps database_roles", "up --no-deps migrate", "up --no-deps database_verify"]) expect(s).toContain(required);
    expect(s.indexOf("pg_restore --list")).toBeLessThan(s.indexOf("compose stop gateway"));
    expect(s).not.toContain("down -v");
    expect(s).not.toContain("docker volume rm");
    expect(s).not.toContain("reset-staging-workspace.sh");
    expect(read("deploy/domain-test/reset-staging-workspace.sh")).toContain("exit 2");
    expect(read("deploy/domain-test/renew-expired-trial.sql")).toContain("RAISE EXCEPTION");
  });
  it("retains HTTPS trusted proxy, one workspace and password-only V4 manual plans", () => {
    const c = read("deploy/domain-test/docker-compose.yml");
    const edge = read("deploy/domain-test/Caddyfile");
    const sample = read("deploy/domain-test/.env.domain-test.example");
    expect(edge).toContain("header_up X-Forwarded-For {http.request.remote.host}");
    expect(edge).toContain("X-Gateway-Proxy-Token");
    expect(c).toContain('YASEIR_STAGING_SINGLE_WORKSPACE: "1"');
    expect(c).toContain("YASEIR_PLAN_CATALOG");
    expect(c).not.toContain("STRIPE_PLAN_CATALOG");
    expect(sample).toContain("APP_BASE_URL=https://print.yaseir.cloud");
    expect(sample).toContain("POSTGRES_OWNER_PASSWORD=");
    expect(sample).toContain("POSTGRES_RUNTIME_PASSWORD=");
    expect(read("docker-compose.yml")).not.toContain("YASEIR_STAGING_FIXTURES_ENABLED");
  });
});
