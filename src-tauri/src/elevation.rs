//! Administrator-only startup gate.
//!
//! The Print Agent manages a Windows service and machine-wide printer
//! state, so the manager app must run with a full administrator token.
//! `enforce_administrator_or_exit` is the FIRST statement of `main()`:
//! before the single-instance mutex, before logging, before the tray,
//! and before any Tauri setup. A non-elevated launch shows NO dialog:
//! it immediately hands off to an elevated copy of the manager (the
//! only prompt is the Windows UAC consent raised by the "runas"
//! relaunch itself) and this process exits at once. If the user
//! declines the UAC prompt or the relaunch fails, this process exits
//! without opening anything — the manager only ever runs elevated.
//! A copy that was already relaunched once (the `--elevated-relaunch`
//! marker `launch_elevated_manager` passes) and is still not elevated
//! exits instead of relaunching again, so the UAC prompt can never
//! loop. A non-elevated process NEVER continues past this gate —
//! nothing else has started, so there is no tray, listener, or
//! background work to clean up.

#[cfg(windows)]
pub fn enforce_administrator_or_exit() {
    if crate::commands::is_running_as_admin() {
        return;
    }
    let relaunched = std::env::args_os()
        .any(|arg| arg.to_string_lossy() == "--elevated-relaunch");
    if relaunched {
        std::process::exit(1);
    }
    // Hand off to the elevated copy and close this one either way.
    // Exit 0 only when the elevated replacement actually launched.
    match crate::commands::relaunch_as_admin() {
        Ok(()) => std::process::exit(0),
        Err(_) => std::process::exit(1),
    }
}

#[cfg(not(windows))]
pub fn enforce_administrator_or_exit() {}
