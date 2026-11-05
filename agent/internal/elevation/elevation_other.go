//go:build !windows

package elevation

func processElevated() bool { return true }

// showAdminRequiredDialog is unreachable on non-Windows builds
// (processElevated always reports true); it exists so the shared gate
// compiles everywhere.
func showAdminRequiredDialog() {}
