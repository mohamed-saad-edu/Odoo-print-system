// Package elevation enforces the Agent's administrator-only startup
// rule: outside the Windows service host (which already runs as
// LocalSystem), an interactive launch without an elevated token shows a
// native dialog and exits before any config, sync, listener or queue
// work starts. The check is deliberately the FIRST thing main() runs.
package elevation

import "os"

// IsElevated reports whether the current process token is elevated
// (a full administrator token under UAC). On non-Windows platforms it
// always reports true: the gate exists for the Windows product only,
// and developer builds elsewhere must not be blocked by it.
func IsElevated() bool {
	return processElevated()
}

// RequireElevatedInteractive enforces the administrator-only rule for
// one interactive entry point. interactive=false means the process was
// started by the Windows Service Control Manager: that path already
// runs as LocalSystem and Session 0 has no desktop to show a dialog on,
// so it returns immediately. Otherwise, when the token is not elevated,
// the native dialog is shown and the process EXITS with code 1 as soon
// as the user dismisses it — nothing else in the process has started
// yet at the point main() calls this.
func RequireElevatedInteractive(interactive bool) {
	if !interactive {
		return
	}
	if IsElevated() {
		return
	}
	showAdminRequiredDialog()
	os.Exit(1)
}
