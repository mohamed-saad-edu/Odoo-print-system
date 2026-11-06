//go:build !windows

package elevation

import "errors"

func processElevated() bool { return true }

// showAdminRequiredDialog is unreachable on non-Windows builds
// (processElevated always reports true); it exists so the shared gate
// compiles everywhere. It reports "no restart requested".
func showAdminRequiredDialog() bool { return false }

// relaunchElevated is likewise unreachable off Windows.
func relaunchElevated() error {
	return errors.New("elevated relaunch is only available on Windows")
}
