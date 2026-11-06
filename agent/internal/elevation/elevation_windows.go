//go:build windows

package elevation

import (
	"errors"
	"os"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	modUser32   = windows.NewLazySystemDLL("user32.dll")
	modComctl32 = windows.NewLazySystemDLL("comctl32.dll")
	modShell32  = windows.NewLazySystemDLL("shell32.dll")

	procMessageBoxW        = modUser32.NewProc("MessageBoxW")
	procTaskDialogIndirect = modComctl32.NewProc("TaskDialogIndirect")
	procShellExecuteW      = modShell32.NewProc("ShellExecuteW")
)

func processElevated() bool {
	// Token.IsElevated reports false for a non-elevated (filtered)
	// token, which is exactly the case this gate must block.
	return windows.GetCurrentProcessToken().IsElevated()
}

const (
	mbOK             = 0x00000000
	mbIconWarning    = 0x00000030
	mbSetForeground  = 0x00010000
	tdWarningIcon    = 0xFFFE // MAKEINTRESOURCE(TD_WARNING_ICON = -2)
	tdfAllowCancel   = 0x0008 // TDF_ALLOW_DIALOG_CANCELLATION
	restartButtonID  = 1001
	dialogResultNone = 0
	idOK             = 1 // MessageBoxW IDOK
	swShowNormal     = 1 // ShellExecuteW SW_SHOWNORMAL
)

// taskDialogButton mirrors TASKDIALOG_BUTTON (comctl32).
type taskDialogButton struct {
	ButtonID int32
	Text     *uint16
}

// taskDialogConfig mirrors TASKDIALOGCONFIG (comctl32, amd64/arm64
// layout). Pointer-typed fields keep Go's alignment identical to the C
// struct; the two icon unions are represented by their pointer form.
type taskDialogConfig struct {
	cbSize                 uint32
	hwndParent             uintptr
	hInstance              uintptr
	dwFlags                uint32
	dwCommonButtons        uint32
	pszWindowTitle         *uint16
	pszMainIcon            uintptr // union: PCWSTR form (MAKEINTRESOURCE)
	pszMainInstruction     *uint16
	pszContent             *uint16
	cButtons               uint32
	pButtons               *taskDialogButton
	nDefaultButton         int32
	cRadioButtons          uint32
	pRadioButtons          *taskDialogButton
	nDefaultRadioButton    int32
	pszVerificationText    *uint16
	pszExpandedInformation *uint16
	pszExpandedControlText *uint16
	pszCollapsedControlTxt *uint16
	pszFooterIcon          uintptr // union: PCWSTR form
	pszFooter              *uint16
	pfCallback             uintptr
	lpCallbackData         int64
	cxWidth                uint32
}

func utf16Ptr(s string) *uint16 {
	ptr, err := syscall.UTF16PtrFromString(s)
	if err != nil {
		return nil
	}
	return ptr
}

const (
	adminDialogTitle       = "Print Agent"
	adminDialogInstruction = "Administrator privileges are required"
	adminDialogContent     = "لازم تشغّل التطبيق بصلاحيات المسؤول (Run as administrator) عشان يشتغل. اضغط «إعادة الفتح كمسؤول» وهنقفل النسخة دي ونفتح التطبيق من جديد بصلاحيات المسؤول.\n\nThis application must be run as administrator to work. Choose \"Restart as Administrator\" and this copy will close and reopen with administrator privileges."
	adminDialogRestartBtn  = "إعادة الفتح كمسؤول · Restart as Administrator"
)

// showAdminRequiredDialog blocks until the user answers the native
// dialog and reports whether they chose the dialog's single action,
// "Restart as Administrator" (true), rather than dismissing it
// (false). It prefers TaskDialogIndirect with that single custom
// button and falls back to a one-button MessageBoxW if the task
// dialog API is unavailable — where OK carries the same meaning the
// content text states — so the gate can never fail open silently.
func showAdminRequiredDialog() bool {
	if err := procTaskDialogIndirect.Find(); err == nil {
		title := utf16Ptr(adminDialogTitle)
		instruction := utf16Ptr(adminDialogInstruction)
		content := utf16Ptr(adminDialogContent)
		restartText := utf16Ptr(adminDialogRestartBtn)
		if title != nil && instruction != nil && content != nil && restartText != nil {
			buttons := []taskDialogButton{{ButtonID: restartButtonID, Text: restartText}}
			cfg := taskDialogConfig{
				dwFlags:            tdfAllowCancel,
				pszWindowTitle:     title,
				pszMainIcon:        tdWarningIcon,
				pszMainInstruction: instruction,
				pszContent:         content,
				cButtons:           1,
				pButtons:           &buttons[0],
				nDefaultButton:     restartButtonID,
			}
			cfg.cbSize = uint32(unsafe.Sizeof(cfg))
			var pressed int32
			ret, _, _ := procTaskDialogIndirect.Call(
				uintptr(unsafe.Pointer(&cfg)),
				uintptr(unsafe.Pointer(&pressed)),
				0,
				0,
			)
			if ret == 0 { // S_OK: dialog shown and answered.
				return pressed == restartButtonID
			}
		}
	}
	// Fallback: a single-OK-button message box whose text states that
	// OK restarts the application as administrator.
	title := utf16Ptr(adminDialogTitle)
	content := utf16Ptr(adminDialogContent)
	if title == nil || content == nil {
		return false
	}
	ret, _, _ := procMessageBoxW.Call(
		0,
		uintptr(unsafe.Pointer(content)),
		uintptr(unsafe.Pointer(title)),
		mbOK|mbIconWarning|mbSetForeground,
	)
	return ret == idOK
}

// relaunchElevated starts an elevated copy of this executable with the
// same arguments via the shell "runas" verb (which raises the UAC
// consent prompt). ShellExecuteW returns a value > 32 on success.
func relaunchElevated() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	verb := utf16Ptr("runas")
	file := utf16Ptr(exe)
	params := utf16Ptr(joinCommandLineArgs(os.Args[1:]))
	if verb == nil || file == nil || params == nil {
		return errors.New("could not encode elevated relaunch parameters")
	}
	ret, _, callErr := procShellExecuteW.Call(
		0,
		uintptr(unsafe.Pointer(verb)),
		uintptr(unsafe.Pointer(file)),
		uintptr(unsafe.Pointer(params)),
		0,
		swShowNormal,
	)
	if ret <= 32 {
		if callErr != nil {
			return callErr
		}
		return syscall.Errno(ret)
	}
	return nil
}

// joinCommandLineArgs renders argv the way the Windows command line
// expects: arguments containing spaces or quotes are wrapped in double
// quotes with embedded quotes/backslash runs escaped. Agent launches
// are normally bare or simple subcommands, but install paths and
// config paths can contain spaces.
func joinCommandLineArgs(args []string) string {
	quoted := make([]string, 0, len(args))
	for _, arg := range args {
		if arg != "" && !strings.ContainsAny(arg, " \t\"") {
			quoted = append(quoted, arg)
			continue
		}
		var b strings.Builder
		b.WriteByte('"')
		backslashes := 0
		for _, r := range arg {
			switch r {
			case '\\':
				backslashes++
			case '"':
				b.WriteString(strings.Repeat("\\", backslashes*2+1))
				b.WriteByte('"')
				backslashes = 0
			default:
				b.WriteString(strings.Repeat("\\", backslashes))
				b.WriteRune(r)
				backslashes = 0
			}
		}
		b.WriteString(strings.Repeat("\\", backslashes*2))
		b.WriteByte('"')
		quoted = append(quoted, b.String())
	}
	return strings.Join(quoted, " ")
}
