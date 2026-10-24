package agent

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/yaseir-agent/agent/internal/printer"
)

func TestDesiredGeometrySurvivesHeartbeatAndChangesFingerprint(t *testing.T) {
	row := desiredPrinterRecord{Desired: testDesiredPrinter("profiled", 1, "active")}
	row.Desired.Protocol = "escpos"
	row.Desired.Config["geometry_profile"] = map[string]interface{}{"printable_width_dots": 1700, "dpi_x": 600, "dpi_y": 600, "paper_width_mm": 80, "raster_command": "gs_v_0"}
	pc := desiredPrinterConfig(row)
	if pc.GeometryProfile == nil || pc.GeometryProfile.PrintableWidthDots != 1700 {
		t.Fatal("desired measured profile was lost")
	}
	backend, err := printer.New(pc)
	if err != nil || !printer.SupportsKind(backend, printer.KindImage) {
		t.Fatalf("explicit raster backend unavailable: %v", err)
	}
	a := heartbeatEvidenceAgent(map[string]printer.Printer{pc.ID: &fakePrinter{}})
	a.printerConfigs[pc.ID] = pc
	entry := heartbeatEntry(t, a.printerStatusPayload(), pc.ID)
	geometry, err := printer.ParseGeometry(entry["capabilities"].(map[string]interface{})["geometry"], pc.ID, "")
	if err != nil || geometry.PrintableWidthDots != 1700 || *geometry.DPIX != 600 {
		t.Fatalf("heartbeat lost exact geometry: %+v %v", geometry, err)
	}
	declared := entry["config"].(map[string]interface{})
	profile, err := printer.ParseGeometryProfile(declared["geometry_profile"])
	if err != nil || profile.PrintableWidthDots != 1700 {
		t.Fatalf("desired roundtrip lost profile: %v", err)
	}
	changed := *pc.GeometryProfile
	dpi := 300
	changed.DPIY = &dpi
	pc.GeometryProfile = &changed
	deadline := time.Now().Add(time.Second)
	for a.getProbeState(pc.ID).running.Load() {
		if time.Now().After(deadline) {
			t.Fatal("prior heartbeat probe did not finish")
		}
		time.Sleep(time.Millisecond)
	}
	a.printersMu.Lock()
	a.printerConfigs[pc.ID] = pc
	a.printersMu.Unlock()
	next := heartbeatEntry(t, a.printerStatusPayload(), pc.ID)
	g2, err := printer.ParseGeometry(next["capabilities"].(map[string]interface{})["geometry"], pc.ID, "")
	if err != nil || g2.ConfigFingerprint == geometry.ConfigFingerprint {
		t.Fatal("DPI change did not invalidate old image geometry")
	}
}

type failedGeometryPrinter struct{ fakePrinter }

func (p *failedGeometryPrinter) PrinterGeometry(context.Context) (*printer.Geometry, error) {
	return nil, fmt.Errorf("measurement unavailable")
}
func (p *failedGeometryPrinter) ObservedCapabilities() map[string]interface{} { return nil }

func TestHeartbeatClearsUnobservedGeometryAndIPPMedia(t *testing.T) {
	a := heartbeatEvidenceAgent(map[string]printer.Printer{"p": &failedGeometryPrinter{}})
	pc := a.printerConfigs["p"]
	pc.Capabilities["geometry"] = map[string]interface{}{"printable_width_dots": 512}
	pc.Capabilities["ipp_capabilities"] = map[string]interface{}{"old": true}
	a.printerConfigs["p"] = pc
	entry := heartbeatEntry(t, a.printerStatusPayload(), "p")
	caps := entry["capabilities"].(map[string]interface{})
	if caps["geometry"] != nil || caps["ipp_capabilities"] != nil {
		t.Fatal("failed measurement refreshed stale printer capabilities")
	}
	if pc.Capabilities["geometry"] == nil || pc.Capabilities["ipp_capabilities"] == nil {
		t.Fatal("projection mutated durable config")
	}
}
