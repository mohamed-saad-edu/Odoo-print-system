package config

import (
	"fmt"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"unicode"
)

var outputProfileIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// PDFOutputProfile is local administrator authority. Neither desired printer
// state nor an individual print payload can create or change this allowlist.
type PDFOutputProfile struct {
	Directory       string           `yaml:"directory" json:"-"`
	GeometryProfile *GeometryProfile `yaml:"geometry_profile,omitempty" json:"-"`
}

func canonicalPDFOutputDirectory(directory string) (string, error) {
	if directory == "" || !filepath.IsAbs(directory) || strings.TrimSpace(directory) != directory || strings.ContainsFunc(directory, unicode.IsControl) || strings.HasPrefix(directory, `\\`) || strings.HasPrefix(directory, "//") {
		return "", fmt.Errorf("PDF output requires an absolute local directory; network, device and relative paths are unsupported")
	}
	clean := filepath.Clean(directory)
	if clean == filepath.VolumeName(clean)+string(filepath.Separator) {
		return "", fmt.Errorf("PDF output requires a dedicated directory, not a filesystem root")
	}
	return clean, nil
}

func validatePDFOutputSelection(pc PrinterConfig) error {
	if pc.NormalizedProtocolOrUnknown() != "pdf" || !outputProfileIDPattern.MatchString(pc.OutputProfileID) {
		return fmt.Errorf("PDF output requires protocol pdf and a valid output_profile_id")
	}
	if pc.Endpoint != "" && pc.Endpoint != "pdf-output:"+pc.OutputProfileID {
		return fmt.Errorf("PDF output endpoint must match its opaque local profile identifier")
	}
	if pc.PrinterType != "" && pc.PrinterType != "file" {
		return fmt.Errorf("PDF output printer_type must be file")
	}
	return nil
}

// ResolvePDFOutput returns a copy resolved exclusively against local YAML
// authority. Internal directory fields are overwritten, never trusted from a
// supplied record. Existence, symlinks, access and output production are probed
// by the backend before it can become operational.
func (c *Config) ResolvePDFOutput(pc PrinterConfig) (PrinterConfig, error) {
	if pc.NormalizedType() != "pdf_output" {
		if pc.OutputProfileID != "" || pc.PDFOutputDirectory != "" || pc.PDFOutputAuthorized {
			return pc, fmt.Errorf("PDF output settings require the pdf_output transport")
		}
		return pc, nil
	}
	pc.PDFOutputDirectory = ""
	pc.PDFOutputAuthorized = false
	if err := validatePDFOutputSelection(pc); err != nil {
		return pc, err
	}
	if c == nil {
		return pc, fmt.Errorf("PDF output profile is not locally authorized")
	}
	profile, ok := c.PDFOutputProfiles[pc.OutputProfileID]
	if !ok {
		return pc, fmt.Errorf("PDF output profile is not locally authorized")
	}
	directory, err := canonicalPDFOutputDirectory(profile.Directory)
	if err != nil {
		return pc, err
	}
	pc.PDFOutputDirectory = directory
	pc.PDFOutputAuthorized = true
	pc.Endpoint = "pdf-output:" + pc.OutputProfileID
	pc.PrinterType = "file"
	if pc.GeometryProfile == nil && profile.GeometryProfile != nil {
		copy := *profile.GeometryProfile
		pc.GeometryProfile = &copy
	}
	return pc, nil
}

func pdfOutputBinding(pc PrinterConfig) (string, error) {
	if err := validatePDFOutputSelection(pc); err != nil {
		return "", err
	}
	if !pc.PDFOutputAuthorized {
		return "", fmt.Errorf("PDF output profile has not been resolved against local authority")
	}
	directory, err := canonicalPDFOutputDirectory(pc.PDFOutputDirectory)
	if err != nil {
		return "", err
	}
	if runtime.GOOS == "windows" {
		directory = strings.ToLower(directory)
	}
	return "pdf-output:" + pc.OutputProfileID + "|directory:" + directory, nil
}
