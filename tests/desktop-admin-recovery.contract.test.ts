import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("desktop administrator recovery and Windows startup UX", () => {
  it("runs elevated or not at all: the native startup gate relaunches with no dialog", () => {
    const commands = read("src-tauri/src/commands.rs");
    const elevation = read("src-tauri/src/elevation.rs");
    const mainRust = read("src-tauri/src/main.rs");
    const ipc = read("src/desktop/lib/ipc.ts");
    const desktop = read("src/desktop/main.tsx");

    expect(commands).toContain("pub fn relaunch_as_admin()");
    expect(commands).toContain("ShellExecuteW");
    expect(commands).toContain('OsStr::new("runas")');
    expect(commands).toContain("--elevated-relaunch");
    // The gate is the first statement of main() and hands a
    // non-elevated launch straight to the elevated relaunch: the UAC
    // consent is the only prompt, and no application dialog exists in
    // the launch path at any layer.
    expect(mainRust).toContain("elevation::enforce_administrator_or_exit();");
    expect(mainRust).toContain("commands::relaunch_as_admin");
    expect(mainRust).toContain("acquire_single_instance(elevated_relaunch)");
    expect(elevation).toContain("pub fn enforce_administrator_or_exit()");
    expect(elevation).toContain("crate::commands::relaunch_as_admin()");
    expect(elevation).not.toContain("TaskDialogIndirect");
    expect(elevation).not.toContain("show_admin_required_dialog");
    expect(desktop).not.toContain("AdminPrivilegeDialog");
    expect(ipc).not.toContain("relaunch_as_admin");
  });

  it("gives an elevated stopped Agent a recovery action", () => {
    const desktop = read("src/desktop/main.tsx");
    expect(desktop).toContain("agentStartupGraceElapsed");
    expect(desktop).toContain('t("desktop.app.agentNeedsStartTitle")');
    expect(desktop).toContain('t("desktop.app.startAgentNow")');
    expect(desktop).not.toContain("setAdminDismissed");
  });

  it("suppresses every bounded Windows helper console window", () => {
    const agent = read("src-tauri/src/agent.rs");
    const paths = read("src-tauri/src/paths.rs");
    const boundedStart = agent.indexOf("pub(crate) fn run_bounded_command");
    const bounded = agent.slice(boundedStart, boundedStart + 1800);
    expect(bounded).toContain("CREATE_NO_WINDOW");
    expect(bounded).toContain("cmd.creation_flags(CREATE_NO_WINDOW)");
    expect(paths).toContain("crate::agent::run_bounded_command");
    expect(paths).toContain('windows_system32_exe("icacls.exe")');
  });

  it("repairs a missing Agent service only through the privileged service path", () => {
    const agent = read("src-tauri/src/agent.rs");
    const mainRust = read("src-tauri/src/main.rs");
    const helperStart = agent.indexOf("fn ensure_service_installed");
    const helper = agent.slice(helperStart, helperStart + 2200);
    expect(helper).toContain("sc_query()?.is_some()");
    expect(helper).toContain('run_agent_service_command(app, "install", COMMAND_TIMEOUT)');
    expect(agent).toContain("ensure_service_installed(app)?");
    expect(mainRust).toContain("!commands::is_running_as_admin()");
    expect(mainRust).toContain("deferring Agent service repair/start until Administrator relaunch");
  });
});
