import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const load = (path: string) => readFileSync(path, "utf8");

describe("HTTPS-only staging transport and non-destructive migration", () => {
  it("does not ship a legacy plain-HTTP staging listener or setup", () => {
    expect(existsSync("deploy/http-test")).toBe(false);
    const compose = load("deploy/domain-test/docker-compose.yml");
    expect(compose).toContain('"443:443"');
    expect(compose).not.toContain("HTTP_TEST_HOST");
    expect(compose).not.toContain("YASEIR_HTTP_TEST_MODE");
    expect(compose).not.toContain("HTTP_TEST_VOLUME_NAME");
    expect(compose).toContain('YASEIR_STAGING_FIXTURES_ENABLED: "1"');
    expect(compose).toContain('name: ${STAGING_PG_VOLUME:?STAGING_PG_VOLUME must be set}');
  });
  it("upgrades only existing HTTPS staging environment; never discards its database", () => {
    const setup = load("deploy/domain-test/setup-domain-test.sh");
    const reset = load("deploy/domain-test/reset-staging-workspace.sh");
    const sample = load("deploy/domain-test/.env.domain-test.example");
    expect(setup).toContain("OLD_VOLUME_KEY=");
    expect(setup).toContain("upsert_env STAGING_PG_VOLUME");
    expect(setup).toContain("docker volume inspect");
    expect(setup).not.toContain("deploy/http-test/");
    expect(setup).not.toContain("docker volume rm");
    expect(setup).not.toContain("down -v");
    expect(reset).toContain("replace_env STAGING_PG_VOLUME");
    expect(reset).toContain("pg_dump -Fc");
    expect(sample).toContain("STAGING_PG_VOLUME=");
    expect(sample).toContain("YASEIR_STAGING_FIXTURES_ENABLED=1");
    expect(sample).not.toContain("HTTP_TEST_VOLUME_NAME");
  });
  it("retains secure transport and limits fixtures to staging", () => {
    const workflow = load(".github/workflows/https-staging-security.yml");
    const source = load("src/lib/staging-single-workspace.ts");
    const email = load("src/lib/email.ts");
    const stripe = load("src/lib/stripe.ts");
    expect(workflow).toContain("HTTPS Gateway + Agent security contracts");
    expect(workflow).toContain("tests/https-staging-policy.contract.test.ts");
    expect(workflow).not.toContain("tests/http-test-");
    expect(workflow).not.toMatch(/^\s+push:/m);
    expect(source).toContain('process.env.APP_BASE_URL === "https://print.yaseir.cloud"');
    for (const s of [source, email, stripe]) {
      expect(s).toContain("YASEIR_STAGING_FIXTURES_ENABLED");
      expect(s).not.toContain("YASEIR_HTTP_TEST_MODE");
    }
  });
});
