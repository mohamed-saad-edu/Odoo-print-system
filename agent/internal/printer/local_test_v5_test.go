package printer

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/yaseir-agent/agent/internal/config"
)

func TestLocalPrinterTestResolvesApprovedPDFOutputProfile(t *testing.T) {
	for _, source := range []string{"configured", "registered"} {
		t.Run(source, func(t *testing.T) {
			output := t.TempDir()
			pc := config.PrinterConfig{ID: "export", Name: "PDF output", Type: "pdf_output", Protocol: "pdf", PrinterType: "file", Endpoint: "pdf-output:approved", OutputProfileID: "approved"}
			cfg := &config.Config{PDFOutputProfiles: map[string]config.PDFOutputProfile{"approved": {Directory: output}}}
			path := filepath.Join(t.TempDir(), "printers.json")
			if source == "configured" {
				cfg.Printers = []config.PrinterConfig{pc}
			} else if err := SaveRegistry(path, []DeviceInfo{{ID: pc.ID, Name: pc.Name, ConnectionType: pc.Type, Protocol: pc.Protocol, PrinterType: pc.PrinterType, Endpoint: pc.Endpoint, OutputProfileID: pc.OutputProfileID, Enabled: true}}); err != nil {
				t.Fatal(err)
			}
			if err := TestPrinter(cfg, path, pc.ID); err != nil {
				t.Fatalf("approved local PDF-output diagnostic failed: %v", err)
			}
			files, err := os.ReadDir(output)
			if err != nil || len(files) != 0 {
				t.Fatalf("verification did not clean its actual temporary artifact: files=%v error=%v", files, err)
			}
		})
	}
}

func TestLocalPrinterTestRejectsUnapprovedPDFOutputProfile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "printers.json")
	if err := SaveRegistry(path, []DeviceInfo{{ID: "export", Name: "PDF output", ConnectionType: "pdf_output", Protocol: "pdf", PrinterType: "file", Endpoint: "pdf-output:missing", OutputProfileID: "missing", Enabled: true}}); err != nil {
		t.Fatal(err)
	}
	if err := TestPrinter(&config.Config{}, path, "export"); err == nil {
		t.Fatal("unapproved registry profile gained local filesystem authority")
	}
}

func TestLocalTestNameMustBeUniqueAcrossRegistryAndConfiguration(t *testing.T) {
	registered := []DeviceInfo{{ID: "registry_printer", Name: "Kitchen", Endpoint: "10.0.0.10:9100"}}
	configured := []DeviceInfo{{ID: "configured_printer", Name: "Kitchen", Endpoint: "10.0.0.11:9100"}}
	if target, err := selectLocalTestTarget(registered, configured, "Kitchen"); err == nil || target != nil {
		t.Fatalf("ambiguous local test chose a different physical destination: target=%+v error=%v", target, err)
	}
	if target, err := selectLocalTestTarget(registered, configured, "configured_printer"); err != nil || target == nil || target.ID != "configured_printer" {
		t.Fatalf("explicit stable ID should disambiguate: target=%+v error=%v", target, err)
	}
}

func TestLocalTestNameRejectsDuplicateIDsWithinOneSource(t *testing.T) {
	registered := []DeviceInfo{{ID: "duplicate", Name: "Kitchen", Endpoint: "10.0.0.10:9100"}, {ID: "duplicate", Name: "Kitchen", Endpoint: "10.0.0.11:9100"}}
	if target, err := selectLocalTestTarget(registered, nil, "Kitchen"); err == nil || target != nil {
		t.Fatalf("duplicate registry identities must not become an unambiguous test target: target=%+v error=%v", target, err)
	}
}
