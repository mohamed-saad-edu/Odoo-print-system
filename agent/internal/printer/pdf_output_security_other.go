//go:build !windows

package printer

import (
	"fmt"
	"os"
	"syscall"
)

func isPDFOutputReparse(os.FileInfo) bool { return false }

func validatePDFOutputVolume(string) error { return nil }

func securePDFOutputHandle(_ string, file *os.File, directory bool) error {
	info, err := file.Stat()
	if err != nil {
		return safePDFOutputError("inspect file ownership", err)
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat.Uid != uint32(os.Geteuid()) {
		return fmt.Errorf("PDF output must be owned by the Agent service account")
	}
	mode := os.FileMode(0600)
	if directory {
		mode = 0700
	}
	if err := file.Chmod(mode); err != nil {
		return safePDFOutputError("restrict permissions", err)
	}
	return nil
}

func syncPDFOutputDirectory(root *os.Root) error {
	dir, err := root.Open(".")
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}
