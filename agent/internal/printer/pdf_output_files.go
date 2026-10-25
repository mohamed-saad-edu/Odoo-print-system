package printer

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/yaseir-agent/agent/internal/config"
)

func safePDFOutputError(operation string, err error) error {
	category := "local filesystem operation failed"
	switch {
	case errors.Is(err, os.ErrPermission):
		category = "access denied"
	case errors.Is(err, os.ErrNotExist):
		category = "approved directory or file is unavailable"
	case errors.Is(err, os.ErrExist):
		category = "generated output name already exists"
	}
	return fmt.Errorf("PDF output %s: %s", operation, category)
}

// OpenRoot anchors all later operations. Reject links/reparse points in the
// configured root path and compare the opened directory identity before any
// ACL change. Relative per-job paths are never accepted.
func openPDFOutputRoot(pc config.PrinterConfig) (*os.Root, error) {
	if !pc.PDFOutputAuthorized || pc.PDFOutputDirectory == "" {
		return nil, fmt.Errorf("PDF output requires a locally authorized profile")
	}
	path := pc.PDFOutputDirectory
	if !filepath.IsAbs(path) || filepath.Clean(path) != path || strings.HasPrefix(path, `\\`) || strings.HasPrefix(path, "//") {
		return nil, fmt.Errorf("invalid local PDF output directory")
	}
	// Traverse one directory at a time from the trusted filesystem/volume
	// root. Each next open is relative to an already pinned parent. Checking
	// absolute path ancestors followed by OpenRoot(path) would leave a race
	// where an ancestor could be replaced by a symlink between those calls.
	volumeRoot := filepath.VolumeName(path) + string(filepath.Separator)
	if err := validatePDFOutputVolume(volumeRoot); err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(volumeRoot)
	if err != nil {
		return nil, safePDFOutputError("open approved directory", err)
	}
	for _, part := range strings.Split(strings.TrimPrefix(path, volumeRoot), string(filepath.Separator)) {
		if part == "" || part == "." || part == ".." {
			root.Close()
			return nil, fmt.Errorf("invalid PDF output directory component")
		}
		before, err := root.Lstat(part)
		if err != nil {
			root.Close()
			return nil, safePDFOutputError("directory validation", err)
		}
		if !before.IsDir() || before.Mode()&os.ModeSymlink != 0 || isPDFOutputReparse(before) {
			root.Close()
			return nil, fmt.Errorf("PDF output directory must not contain a symbolic link or reparse point")
		}
		next, err := root.OpenRoot(part)
		if err != nil {
			root.Close()
			return nil, safePDFOutputError("open directory component", err)
		}
		handle, err := next.Open(".")
		var actual os.FileInfo
		if err == nil {
			actual, err = handle.Stat()
			handle.Close()
		}
		root.Close()
		if err != nil || !os.SameFile(before, actual) {
			next.Close()
			return nil, fmt.Errorf("PDF output directory identity changed while opening")
		}
		root = next
	}
	directory, err := root.Open(".")
	if err != nil {
		root.Close()
		return nil, safePDFOutputError("open directory handle", err)
	}
	defer directory.Close()
	if err := securePDFOutputHandle(path, directory, true); err != nil {
		root.Close()
		return nil, err
	}
	return root, nil
}

func newPDFArtifactID() (string, error) {
	var value [24]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", fmt.Errorf("PDF output could not allocate a secure artifact identifier")
	}
	return hex.EncodeToString(value[:]), nil
}

func writePDFWithContext(ctx context.Context, file *os.File, data []byte) error {
	for len(data) > 0 {
		if err := ctx.Err(); err != nil {
			return err
		}
		part := min(len(data), 64*1024)
		n, err := file.Write(data[:part])
		if err != nil {
			return safePDFOutputError("write", err)
		}
		if n != part {
			return fmt.Errorf("PDF output write was incomplete")
		}
		data = data[part:]
	}
	return nil
}

// writeVerifiedPDF stages and validates a bounded file, then publishes it with
// an atomic no-overwrite hard link. Unsupported filesystems fail closed during
// operational verification. No customer-visible .pdf exists while writing.
func writeVerifiedPDF(ctx context.Context, pc config.PrinterConfig, data []byte, probe bool) (*OutputEvidence, error) {
	if len(data) < 1 || len(data) > MaxPDFOutputBytes {
		return nil, fmt.Errorf("PDF output exceeds the bounded document size")
	}
	pages, err := inspectBoundedPDFPages(ctx, data, MaxPDFOutputBytes)
	if err != nil {
		return nil, fmt.Errorf("PDF output document validation: %w", err)
	}
	root, err := openPDFOutputRoot(pc)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	id, err := newPDFArtifactID()
	if err != nil {
		return nil, err
	}
	staging := ".yaseir-" + id + ".tmp"
	name := id + ".pdf"
	if probe {
		name = ".yaseir-verification-" + id + ".tmp"
	}
	file, err := root.OpenFile(staging, os.O_RDWR|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return nil, safePDFOutputError("exclusive create", err)
	}
	closed := false
	defer func() {
		if !closed {
			_ = file.Close()
		}
		_ = root.Remove(staging)
	}()
	if err := securePDFOutputHandle(filepath.Join(pc.PDFOutputDirectory, staging), file, false); err != nil {
		return nil, err
	}
	created, err := file.Stat()
	if err != nil || !created.Mode().IsRegular() {
		return nil, fmt.Errorf("PDF output staging handle is not a regular file")
	}
	if err := writePDFWithContext(ctx, file, data); err != nil {
		return nil, err
	}
	if err := file.Sync(); err != nil {
		return nil, safePDFOutputError("flush", err)
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return nil, safePDFOutputError("readback seek", err)
	}
	readback, err := io.ReadAll(io.LimitReader(file, MaxPDFOutputBytes+1))
	if err != nil {
		return nil, safePDFOutputError("readback", err)
	}
	if !bytes.Equal(data, readback) {
		return nil, fmt.Errorf("PDF output readback differs from the submitted document")
	}
	validated, err := inspectBoundedPDFPages(ctx, readback, MaxPDFOutputBytes)
	if err != nil || len(validated) != len(pages) {
		return nil, fmt.Errorf("PDF output readback failed document validation")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := file.Close(); err != nil {
		closed = true
		return nil, safePDFOutputError("close staging", err)
	}
	closed = true
	if !probe {
		// Preparation can outlive a claim, sharing permission, binding or
		// shutdown transition. Recheck at the last reversible boundary.
		// Verification probes do not recurse through Agent admission.
		if err := runDispatchAdmission(ctx); err != nil {
			return nil, fmt.Errorf("PDF output admission refused before publication: %w", err)
		}
	}
	if err := root.Link(staging, name); err != nil {
		return nil, safePDFOutputError("publish without overwrite", err)
	}
	// Once publication succeeds, any unproven late result is UNKNOWN. A
	// subsequent job must never infer absence from an error or missing report.
	publicationErr := func(message string) (*OutputEvidence, error) {
		return nil, MarkUnknown("PDF file publication occurred but %s; reconcile the output before another job", message)
	}
	if err := syncPDFOutputDirectory(root); err != nil {
		return publicationErr("durability could not be confirmed")
	}
	info, err := root.Lstat(name)
	if err != nil || !info.Mode().IsRegular() || !os.SameFile(created, info) {
		return publicationErr("published file identity could not be confirmed")
	}
	verify, err := root.Open(name)
	if err != nil {
		return publicationErr("published file could not be reopened")
	}
	hash := sha256.New()
	size, readErr := io.Copy(hash, io.LimitReader(verify, MaxPDFOutputBytes+1))
	closeErr := verify.Close()
	expected := sha256.Sum256(data)
	if readErr != nil || closeErr != nil || size != int64(len(data)) || !bytes.Equal(hash.Sum(nil), expected[:]) {
		return publicationErr("published file readback could not be confirmed")
	}
	if err := root.Remove(staging); err != nil {
		return publicationErr("staging cleanup could not be confirmed")
	}
	if probe {
		if err := root.Remove(name); err != nil {
			return publicationErr("verification-file cleanup could not be confirmed")
		}
		if err := syncPDFOutputDirectory(root); err != nil {
			return publicationErr("verification cleanup durability could not be confirmed")
		}
		return nil, nil
	}
	evidence := &OutputEvidence{OutputMedium: "file", ArtifactID: id, SHA256: hex.EncodeToString(expected[:]), PageCount: len(pages), Bytes: size}
	if err := ctx.Err(); err != nil {
		return publicationErr("the invocation ended before result evidence was recorded")
	}
	return evidence, nil
}
