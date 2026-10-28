import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Agent pairing audit vocabulary and transaction fence", () => {
  it("does not claim completed pairing when an owner only issues a code", () => {
    const creation = readFileSync("src/lib/agent-control.ts", "utf8");
    expect(creation).toContain('action: "agent.pairing_code_issued"');
    expect(creation).not.toContain('action: "agent.paired"');
  });

  it("records the completed pairing only after the credential update in its transaction", () => {
    const register = readFileSync("src/app/api/agent/register/route.ts", "utf8");
    const update = register.indexOf("const updated = await tx.execute");
    const check = register.indexOf("if (updated.rows.length !== 1)", update);
    const audit = register.indexOf('action: "agent.paired"', check);
    const success = register.indexOf('return { kind: "paired"', check);
    expect(update).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(update);
    expect(audit).toBeGreaterThan(check);
    expect(success).toBeGreaterThan(audit);
    expect(register.slice(check, success)).toContain("await writeAuditEvent({");
    expect(register.slice(audit, success)).toContain("}, tx)");
  });
});
