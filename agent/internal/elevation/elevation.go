// Package elevation enforces the Agent's administrator-only startup
// rule: outside the Windows service host (which already runs as
// LocalSystem), an interactive launch without an elevated token shows a
// native dialog and exits before any config, sync, listener or queue
// work starts. The dialog's single action is "Restart as
// Administrator": choosing it hands off to an elevated copy of the
// application and closes this one; dismissing it just closes. A
// non-elevated process NEVER continues past this gate. The check is
// deliberately the FIRST thing main() runs.
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
// the native dialog is shown and the process EXITS as soon as the user
// answers it — exit 0 only when an elevated replacement process was
// successfully launched, exit 1 in every other case. Nothing else in
// the process has started yet at the point main() calls this.
func RequireElevatedInteractive(interactive bool) {
	if !interactive {
		return
	}
	if IsElevated() {
		return
	}
	if showAdminRequiredDialog() {
		if err := relaunchElevated(); err == nil {
			os.Exit(0)
		}
	}
	os.Exit(1)
}
