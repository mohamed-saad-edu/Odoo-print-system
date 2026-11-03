import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Local discovery results must carry the verified local Agent identity.
// WP4 correction (WP0 S3 PROVEN): the dialog must NOT demand an exact
// agentId match — local inventory rows (`printers list`) carry NO agentId
// at all, so an exact-match filter emptied the picker by construction.
// The rule is now: a row is pickable when it has no agentId OR its
// agentId equals the selected agent; rows owned by a different agent
// record are excluded AND warned about (pickerAgentMismatchRows).
describe("local discovery to picker agent ownership", () => {
  it("stamps the paired agent id into CLI discovery JSON", () => {
    const cli = readFileSync("agent/cmd/cli/main.go", "utf8");
    expect(cli).toContain('AgentID string `json:"agentId,omitempty"`');
    expect(cli).toContain("ownedPrinter{DeviceInfo: device, AgentID: loaded.cfg.Agent.ID}");
  });

  it("preserves agentId across the Rust IPC boundary", () => {
    const commands = readFileSync("src-tauri/src/commands.rs", "utf8");
    expect(commands).toContain('rename = "agentId"');
    expect(commands).toContain("pub agent_id: Option<String>");
  });

  it("filters local discovery by the selected agent instead of dropping it", () => {
    const dialog = readFileSync("src/desktop/components/AddPrinterDialog.tsx", "utf8");
    const helpers = readFileSync("src/desktop/lib/printers.ts", "utf8");
    // The dialog picks through the shared eligibility helpers, never a
    // bare exact-match filter (that was the S3 empty-picker bug).
    expect(dialog).toContain("pickerSpoolerRows(printers, currentAgentId)");
    expect(dialog).toContain("pickerAgentMismatchRows(printers, currentAgentId)");
    expect(dialog).not.toContain("p.agentId === currentAgentId && isProductionPrinter");
    // Eligibility: absent agentId does not disqualify; a present agentId
    // must equal the selected agent.
    expect(helpers).toContain("!p.agentId || p.agentId === currentAgentId");
    // Filter on the selected Agent from the exact currently configured Gateway.
    expect(dialog).toContain('const currentAgentId = agentsForUrl === gatewayUrl ? agentId : "";');
  });
});
