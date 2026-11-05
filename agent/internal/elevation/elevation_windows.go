//go:build windows

package elevation

import (
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	modUser32   = windows.NewLazySystemDLL("user32.dll")
	modComctl32 = windows.NewLazySystemDLL("comctl32.dll")

	procMessageBoxW        = modUser32.NewProc("MessageBoxW")
	procTaskDialogIndirect = modComctl32.NewProc("TaskDialogIndirect")
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
	closeButtonID    = 1001
	dialogResultNone = 0
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
	adminDialogContent     = "لازم تشغّل التطبيق بصلاحيات المسؤول (Run as administrator). من فضلك أغلق التطبيق وافتحه مرة تانية بوضع Administrator.\n\nThis application must be run as administrator. Please close it and open it again using \"Run as administrator\"."
	adminDialogCloseButton = "Close Application"
)

// showAdminRequiredDialog blocks until the user dismisses the native
// dialog. It prefers TaskDialogIndirect with a single custom
// "Close Application" button (the exact affordance the product spec
// asks for) and falls back to a one-button MessageBoxW if the task
// dialog API is unavailable, so the gate can never fail open silently.
func showAdminRequiredDialog() {
	if err := procTaskDialogIndirect.Find(); err == nil {
		title := utf16Ptr(adminDialogTitle)
		instruction := utf16Ptr(adminDialogInstruction)
		content := utf16Ptr(adminDialogContent)
		closeText := utf16Ptr(adminDialogCloseButton)
		if title != nil && instruction != nil && content != nil && closeText != nil {
			buttons := []taskDialogButton{{ButtonID: closeButtonID, Text: closeText}}
			cfg := taskDialogConfig{
				dwFlags:            tdfAllowCancel,
				pszWindowTitle:     title,
				pszMainIcon:        tdWarningIcon,
				pszMainInstruction: instruction,
				pszContent:         content,
				cButtons:           1,
				pButtons:           &buttons[0],
				nDefaultButton:     closeButtonID,
			}
			cfg.cbSize = uint32(unsafe.Sizeof(cfg))
			var pressed int32
			ret, _, _ := procTaskDialogIndirect.Call(
				uintptr(unsafe.Pointer(&cfg)),
				uintptr(unsafe.Pointer(&pressed)),
				0,
				0,
			)
			if ret == 0 { // S_OK: dialog shown and dismissed.
				return
			}
		}
	}
	// Fallback: a single-OK-button message box. Dismissing it has the
	// same effect — RequireElevatedInteractive exits right after.
	title := utf16Ptr(adminDialogTitle)
	content := utf16Ptr(adminDialogContent)
	if title == nil || content == nil {
		return
	}
	procMessageBoxW.Call(
		0,
		uintptr(unsafe.Pointer(content)),
		uintptr(unsafe.Pointer(title)),
		mbOK|mbIconWarning|mbSetForeground,
	)
}
