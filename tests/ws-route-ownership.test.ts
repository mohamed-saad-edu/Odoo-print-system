import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("agent WebSocket route ownership", () => {
  it("refunds exactly one WebSocket upgrade reservation after successful authentication", () => {
    const source = readFileSync("src/lib/ws-rate-limit.ts", "utf8");
    const wsSource = readFileSync("src/server/ws.ts", "utf8");
    expect(source).toContain("export async function recordWsUpgradeSuccess");
    // v4 WP3 (B5-02): refund-one, never DELETE the shared per-IP bucket —
    // a DELETE let one legitimate reconnect wipe another agent's failures
    // behind the same NAT IP and grant a fresh budget.
    expect(source).toContain("GREATEST(failures - 1, 0)");
    expect(source).not.toContain("DELETE FROM auth_rate_limits");
    expect(wsSource).toContain("recordWsUpgradeSuccess(clientKey)");
  });

  it("keeps the /api/agent/ws path exclusively on the custom HTTP upgrade server", () => {
    expect(existsSync("src/app/api/agent/ws/route.ts")).toBe(false);
    const serverSource = readFileSync("server.ts", "utf8");
    const wsSource = readFileSync("src/server/ws.ts", "utf8");
    expect(serverSource).toContain("attachAgentWSS(server)");
    expect(wsSource).toContain('server.on("upgrade"');
    expect(wsSource).toContain('new WebSocketServer({ noServer: true');
  });
});
