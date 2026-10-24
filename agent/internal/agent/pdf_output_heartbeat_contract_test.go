package agent

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/yaseir-agent/agent/internal/config"
)

func pdfHeartbeatProfile() *config.GeometryProfile {
	dpi, height, offset := 203, 2200, 79
	widthMM, heightMM := 210.0, 297.0
	return &config.GeometryProfile{PrintableWidthDots: 1500, PrintableHeightDots: &height,
		DPIX: &dpi, DPIY: &dpi, PaperWidthMM: &widthMM, PaperHeightMM: &heightMM,
		OffsetXDots: &offset, OffsetYDots: &offset}
}

// This catches a real wire incompatibility: Gateway's PDF configuration
// accepts only the opaque selector and optional measurements after stripping
// the legacy protocol envelope. Generic printer metadata belongs elsewhere.
func TestPDFOutputHeartbeatConfigMatchesPublicContract(t *testing.T) {
	for _, variant := range []string{"selector-only", "full-geometry", "generic-metadata"} {
		t.Run(variant, func(t *testing.T) {
			privateDirectory := t.TempDir()
			pc := config.PrinterConfig{ID: "pdf-contract", Name: "Approved PDF output", Type: "pdf_output",
				Protocol: "pdf", PrinterType: "file", OutputProfileID: "approved", Endpoint: "pdf-output:approved"}
			if variant != "selector-only" {
				pc.GeometryProfile = pdfHeartbeatProfile()
			}
			if variant == "generic-metadata" {
				pc.PaperWidthMM = 210
				pc.Capabilities = map[string]interface{}{
					"supports_color": true, "supported_protocols": []interface{}{"pdf", "image"},
					"vendor_note": "display metadata", "paper_width_mm": 80, "paper_widths": []interface{}{80},
					"protocol": "raw", "printer_type": "physical", "output_profile_id": "different",
					"directory": privateDirectory, "output_directory": privateDirectory,
					"pdf_output_directory": privateDirectory, "_raw": "invalid metadata",
				}
			}
			cfg := &config.Config{PDFOutputProfiles: map[string]config.PDFOutputProfile{"approved": {Directory: privateDirectory}}}
			resolved, err := cfg.ResolvePDFOutput(pc)
			if err != nil {
				t.Fatal(err)
			}
			encoded, err := json.Marshal(endpointToConfig(resolved))
			if err != nil {
				t.Fatal(err)
			}
			var wire map[string]interface{}
			if err := json.Unmarshal(encoded, &wire); err != nil {
				t.Fatal(err)
			}
			if wire["protocol"] != "pdf" || wire["output_profile_id"] != "approved" {
				t.Fatalf("declared PDF transport or locally approved selector changed: %s", encoded)
			}
			for key := range wire {
				if key != "protocol" && key != "output_profile_id" && key != "geometry_profile" {
					t.Errorf("PDF connection configuration contains Gateway-forbidden field %q", key)
				}
			}
			if strings.Contains(string(encoded), privateDirectory) {
				t.Error("private local output directory leaked into wire configuration")
			}
			if variant == "selector-only" {
				if _, invented := wire["geometry_profile"]; invented {
					t.Error("missing measurements were invented")
				}
			} else {
				want := map[string]interface{}{"printable_width_dots": float64(1500), "printable_height_dots": float64(2200),
					"dpi_x": float64(203), "dpi_y": float64(203), "paper_width_mm": float64(210), "paper_height_mm": float64(297),
					"offset_x_dots": float64(79), "offset_y_dots": float64(79)}
				if !reflect.DeepEqual(wire["geometry_profile"], want) {
					t.Fatalf("explicit geometry did not survive serialization: %s", encoded)
				}
			}
		})
	}
}

// Exercise the real heartbeat builder and real file backend, not a fake
// printer. The JSON log is also consumed by the unchanged Gateway validator
// in the retained cross-language regression evidence.
func TestPDFOutputHeartbeatEnvelopeKeepsSeparateCapabilities(t *testing.T) {
	outputDirectory := t.TempDir()
	cfg := &config.Config{PDFOutputProfiles: map[string]config.PDFOutputProfile{"approved": {Directory: outputDirectory}},
		Printers: []config.PrinterConfig{{ID: "pdf-envelope", Name: "Approved PDF output", Type: "pdf_output", Protocol: "pdf",
			PrinterType: "file", OutputProfileID: "approved", Endpoint: "pdf-output:approved", PaperWidthMM: 210,
			GeometryProfile: pdfHeartbeatProfile(), Capabilities: map[string]interface{}{
				"supports_color": true, "supported_protocols": []interface{}{"pdf", "image"},
			}}}}
	a, err := New(cfg, filepath.Join(t.TempDir(), "config.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := a.Close(); err != nil {
			t.Error(err)
		}
	})
	inventory := a.printerStatusPayload()
	encoded, err := json.Marshal(inventory)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("PDF_OUTPUT_HEARTBEAT_JSON=%s", encoded)
	if len(inventory) != 1 || inventory[0]["printerType"] != "file" || inventory[0]["connectionType"] != "pdf_output" || inventory[0]["protocol"] != "pdf" {
		t.Fatalf("file-output transport envelope changed: %s", encoded)
	}
	caps := inventory[0]["capabilities"].(map[string]interface{})
	if caps["supports_color"] != true || !reflect.DeepEqual(caps["supported_protocols"], []interface{}{"pdf", "image"}) || caps["paper_width_mm"] != 210 {
		t.Fatalf("separate capability/media metadata lost: %s", encoded)
	}
	for key := range inventory[0]["config"].(map[string]interface{}) {
		if key != "protocol" && key != "output_profile_id" && key != "geometry_profile" {
			t.Errorf("actual heartbeat carries Gateway-forbidden PDF config field %q", key)
		}
	}
	if strings.Contains(string(encoded), outputDirectory) {
		t.Error("local allowlist directory leaked into heartbeat")
	}
	files, err := os.ReadDir(outputDirectory)
	if err != nil || len(files) != 0 {
		t.Fatalf("inventory observation published output: files=%v error=%v", files, err)
	}
}

func TestPhysicalEndpointProjectionRetainsLegacyMetadata(t *testing.T) {
	for _, entry := range []struct {
		name string
		pc   config.PrinterConfig
		want map[string]interface{}
	}{
		{"tcp", config.PrinterConfig{Type: "network", Protocol: "raw", Endpoint: "192.168.1.20:9100"},
			map[string]interface{}{"protocol": "raw", "ip": "192.168.1.20", "port": 9100}},
		{"spooler", config.PrinterConfig{Type: "spooler", Protocol: "spooler", SpoolerName: "Selected Queue"},
			map[string]interface{}{"protocol": "spooler", "spooler_name": "Selected Queue", "address": "Selected Queue"}},
		{"ipp", config.PrinterConfig{Type: "ipp", Protocol: "ipp", Endpoint: "ipp://192.168.1.20:631/ipp/print"},
			map[string]interface{}{"protocol": "ipp", "address": "ipp://192.168.1.20:631/ipp/print", "ipp_url": "ipp://192.168.1.20:631/ipp/print", "ip": "192.168.1.20", "port": 631, "host": "192.168.1.20:631"}},
	} {
		t.Run(entry.name, func(t *testing.T) {
			pc := entry.pc
			pc.PrinterType, pc.PaperWidthMM = "physical", 210
			pc.Capabilities = map[string]interface{}{"supports_color": true}
			entry.want["printer_type"], entry.want["paper_width_mm"] = "physical", 210
			entry.want["paper_widths"], entry.want["supports_color"] = []interface{}{210}, true
			if got := endpointToConfig(pc); !reflect.DeepEqual(got, entry.want) {
				t.Fatalf("physical transport metadata changed: got=%v want=%v", got, entry.want)
			}
		})
	}
}
