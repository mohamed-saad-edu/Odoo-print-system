//go:build windows

package printer

import (
	"fmt"
	"os"
	"syscall"

	"golang.org/x/sys/windows"
)

func isPDFOutputReparse(info os.FileInfo) bool {
	attributes, ok := info.Sys().(*syscall.Win32FileAttributeData)
	return !ok || attributes == nil || attributes.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0
}

func validatePDFOutputVolume(root string) error {
	name, err := windows.UTF16PtrFromString(root)
	if err != nil {
		return fmt.Errorf("invalid PDF output volume")
	}
	kind := windows.GetDriveType(name)
	if kind != windows.DRIVE_FIXED && kind != windows.DRIVE_REMOVABLE {
		return fmt.Errorf("PDF output requires a local writable disk volume")
	}
	return nil
}

func securePDFOutputHandle(path string, opened *os.File, directory bool) error {
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return fmt.Errorf("invalid PDF output path")
	}
	flags := uint32(windows.FILE_FLAG_OPEN_REPARSE_POINT)
	if directory {
		flags |= windows.FILE_FLAG_BACKUP_SEMANTICS
	}
	handle, err := windows.CreateFile(name, windows.READ_CONTROL|windows.WRITE_DAC|windows.WRITE_OWNER|windows.FILE_READ_ATTRIBUTES,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_EXISTING, flags, 0)
	if err != nil {
		return safePDFOutputError("open security handle", err)
	}
	securityFile := os.NewFile(uintptr(handle), "pdf-output-security")
	defer securityFile.Close()
	want, wantErr := opened.Stat()
	actual, actualErr := securityFile.Stat()
	var attributes windows.ByHandleFileInformation
	if wantErr != nil || actualErr != nil || !os.SameFile(want, actual) || windows.GetFileInformationByHandle(handle, &attributes) != nil || attributes.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
		return fmt.Errorf("PDF output file identity changed before access-control validation")
	}
	token, err := windows.OpenCurrentProcessToken()
	if err != nil {
		return fmt.Errorf("PDF output cannot identify the Agent service account")
	}
	defer token.Close()
	user, err := token.GetTokenUser()
	if err != nil {
		return fmt.Errorf("PDF output cannot identify the Agent service account")
	}
	sddl := fmt.Sprintf("D:P(A;OICI;GA;;;%s)(A;OICI;GA;;;SY)(A;OICI;GA;;;BA)", user.User.Sid.String())
	descriptor, err := windows.SecurityDescriptorFromString(sddl)
	if err != nil || descriptor == nil {
		return fmt.Errorf("PDF output access-control descriptor is unavailable")
	}
	dacl, _, err := descriptor.DACL()
	if err != nil || dacl == nil {
		return fmt.Errorf("PDF output access-control descriptor is invalid")
	}
	if err := windows.SetSecurityInfo(handle, windows.SE_FILE_OBJECT, windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, user.User.Sid, nil, dacl, nil); err != nil {
		return safePDFOutputError("restrict owner and permissions", err)
	}
	return nil
}

// File.Sync uses FlushFileBuffers on the actual written file. Windows does not
// expose a supported directory fsync operation. Root keeps subsequent I/O
// anchored to the opened directory even if its path is renamed; it does not
// promise a no-rename lock. Native ACL/reparse and power-loss behavior require
// Windows execution evidence and are not established by cross-compilation.
func syncPDFOutputDirectory(*os.Root) error { return nil }
