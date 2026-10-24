package config

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

type pdfOutputResolver interface {
	ResolvePDFOutput(PrinterConfig) (PrinterConfig, error)
}

func TestPDFOutputRequiresLocallyAuthorizedProfile(t *testing.T) {
	dir := t.TempDir()
	raw := map[string]interface{}{"pdf_output_profiles": map[string]interface{}{"approved": map[string]interface{}{"directory": dir}}, "printers": []map[string]interface{}{{"id": "export", "name": "PDF output", "type": "pdf_output", "protocol": "pdf", "printer_type": "file", "output_profile_id": "approved", "endpoint": "pdf-output:approved"}}}
	encoded, err := yaml.Marshal(raw)
	if err != nil {
		t.Fatal(err)
	}
	var cfg Config
	if err := yaml.Unmarshal(encoded, &cfg); err != nil {
		t.Fatal(err)
	}
	resolver, ok := interface{}(&cfg).(pdfOutputResolver)
	if !ok {
		t.Fatal("no local authority resolver exists for PDF output profiles")
	}
	pc, err := resolver.ResolvePDFOutput(cfg.Printers[0])
	if err != nil {
		t.Fatal(err)
	}
	if err := ValidatePrinterConfig(pc); err != nil {
		t.Fatal(err)
	}
	public, err := json.Marshal(pc)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(public), dir) {
		t.Fatal("private output directory leaked through serialized printer config")
	}
	if _, err := PrinterBindingDigest(pc); err != nil {
		t.Fatal(err)
	}
	var unapproved PrinterConfig
	if err := yaml.Unmarshal([]byte("id: bad\nname: Bad\ntype: pdf_output\nprotocol: pdf\noutput_profile_id: absent\nendpoint: pdf-output:absent\n"), &unapproved); err != nil {
		t.Fatal(err)
	}
	if _, err := resolver.ResolvePDFOutput(unapproved); err == nil {
		t.Fatal("remote profile name created local directory authority")
	}
	for _, endpoint := range []string{filepath.Join(dir, "picked.pdf"), "pdf-output:another", "../../outside"} {
		changed := cfg.Printers[0]
		changed.Endpoint = endpoint
		if _, err := resolver.ResolvePDFOutput(changed); err == nil {
			t.Fatalf("arbitrary destination %q admitted", endpoint)
		}
	}
}

func TestPDFOutputDirectoryChangesInvalidateBinding(t *testing.T) {
	var cfg Config
	first, second := t.TempDir(), t.TempDir()
	load := func(dir string) PrinterConfig {
		raw, err := yaml.Marshal(map[string]interface{}{"pdf_output_profiles": map[string]interface{}{"approved": map[string]interface{}{"directory": dir}}, "printers": []map[string]interface{}{{"id": "same-id", "name": "PDF", "type": "pdf_output", "protocol": "pdf", "printer_type": "file", "output_profile_id": "approved", "endpoint": "pdf-output:approved"}}})
		if err != nil {
			t.Fatal(err)
		}
		if err := yaml.Unmarshal(raw, &cfg); err != nil {
			t.Fatal(err)
		}
		resolver, ok := interface{}(&cfg).(pdfOutputResolver)
		if !ok {
			t.Fatal("PDF output profile resolution is unavailable")
		}
		pc, err := resolver.ResolvePDFOutput(cfg.Printers[0])
		if err != nil {
			t.Fatal(err)
		}
		return pc
	}
	a, err := PrinterBindingDigest(load(first))
	if err != nil {
		t.Fatal(err)
	}
	b, err := PrinterBindingDigest(load(second))
	if err != nil {
		t.Fatal(err)
	}
	if a == b {
		t.Fatal("a changed authorized local destination retained stale operational proof")
	}
}
