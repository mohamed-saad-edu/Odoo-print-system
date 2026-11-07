import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appBaseUrl, sendTransactionalEmail } from "../src/lib/email";

describe("HTTPS staging email capture and secure-origin policy", () => {
  it("rejects HTTP in production even when staging test features are enabled", () => {
    const previousMode = process.env.YASEIR_STAGING_FIXTURES_ENABLED;
    const previousNodeEnv = process.env.NODE_ENV;
    const previousBaseUrl = process.env.APP_BASE_URL;
    try {
      Reflect.set(process.env, "NODE_ENV", "production");
      process.env.YASEIR_STAGING_FIXTURES_ENABLED = "1";
      process.env.APP_BASE_URL = "http://127.0.0.1:8080";
      expect(() => appBaseUrl(new Request("http://127.0.0.1:8080/api/auth/register"))).toThrow("APP_BASE_URL must use HTTPS in production");
      process.env.APP_BASE_URL = "https://print.yaseir.cloud";
      expect(appBaseUrl(new Request("https://print.yaseir.cloud/api/auth/register"))).toBe("https://print.yaseir.cloud");
      process.env.APP_BASE_URL = "http://127.0.0.1:8080";

      process.env.YASEIR_STAGING_FIXTURES_ENABLED = "0";
      expect(() => appBaseUrl(new Request("http://127.0.0.1:8080/api/auth/register"))).toThrow("APP_BASE_URL must use HTTPS in production");
    } finally {
      if (previousMode === undefined) delete process.env.YASEIR_STAGING_FIXTURES_ENABLED;
      else process.env.YASEIR_STAGING_FIXTURES_ENABLED = previousMode;
      if (previousNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
      else Reflect.set(process.env, "NODE_ENV", previousNodeEnv);
      if (previousBaseUrl === undefined) delete process.env.APP_BASE_URL;
      else process.env.APP_BASE_URL = previousBaseUrl;
    }
  });

  it("captures verification email content only in explicit HTTPS staging fixture mode", async () => {
    const dir = mkdtempSync(join(tmpdir(), "yasser-email-capture-"));
    const file = join(dir, "verification-email.txt");
    const previousMode = process.env.YASEIR_STAGING_FIXTURES_ENABLED;
    const previousFile = process.env.YASEIR_TEST_EMAIL_CAPTURE_FILE;
    const previousBaseUrl = process.env.APP_BASE_URL;
    const previousSingle = process.env.YASEIR_STAGING_SINGLE_WORKSPACE;
    const previousResend = process.env.RESEND_API_KEY;
    try {
      delete process.env.RESEND_API_KEY;
      process.env.APP_BASE_URL = "https://print.yaseir.cloud";
      process.env.YASEIR_STAGING_SINGLE_WORKSPACE = "1";
      process.env.YASEIR_STAGING_FIXTURES_ENABLED = "1";
      process.env.YASEIR_TEST_EMAIL_CAPTURE_FILE = file;

      await sendTransactionalEmail({
        to: "test@example.invalid",
        subject: "Verify your Yasser account",
        html: "<p>Verify</p>",
        text: "Verify your Yasser account: http://127.0.0.1/verify-email?token=test-token",
      });

      const captured = readFileSync(file, "utf8");
      expect(captured).toContain("TO: test@example.invalid");
      expect(captured).toContain("Verify your Yasser account");
      expect(captured).toContain("http://127.0.0.1/verify-email?token=test-token");
    } finally {
      if (previousMode === undefined) delete process.env.YASEIR_STAGING_FIXTURES_ENABLED;
      else process.env.YASEIR_STAGING_FIXTURES_ENABLED = previousMode;
      if (previousFile === undefined) delete process.env.YASEIR_TEST_EMAIL_CAPTURE_FILE;
      else process.env.YASEIR_TEST_EMAIL_CAPTURE_FILE = previousFile;
      for (const [key, previous] of [["APP_BASE_URL", previousBaseUrl], ["YASEIR_STAGING_SINGLE_WORKSPACE", previousSingle], ["RESEND_API_KEY", previousResend]] as const) {
        if (previous === undefined) delete process.env[key]; else process.env[key] = previous;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
