package agent

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/yaseir-agent/agent/internal/printer"
)

// The registry can become unreadable after the initial heartbeat reload and
// during a slow printer Status probe. An empty result is NOT an authoritative
// assertion that every previously shared Gateway printer disappeared.
type corruptRegistryOnStatus struct {
	fakePrinter
	registryPath string
	writeErr     error
}

func (p *corruptRegistryOnStatus) Status() string {
	p.writeErr = os.WriteFile(p.registryPath, []byte("not a JSON printer registry"), 0600)
	return "online"
}

func TestUnreadableDisablementCannotDeclareHeartbeatInventoryComplete(t *testing.T) {
	a := newTestAgent(t, "local", &fakePrinter{})
	if err := os.WriteFile(a.registryPath, []byte("not a JSON printer registry"), 0600); err != nil {
		t.Fatal(err)
	}
	rows, complete := a.printerStatusPayloadWithSharingResult(a.loadLocalPrinterSharing())
	if complete || len(rows) != 0 {
		t.Fatalf("unreadable disablement is not a complete inventory: rows=%v complete=%v", rows, complete)
	}
	pages := buildHeartbeatPayloadPages(rows, nil, nil, nil, nil, complete)
	if len(pages) != 1 || pages[0]["inventoryComplete"] != false {
		t.Fatalf("incomplete inventory must not become a Gateway removal snapshot: %+v", pages)
	}
}

func TestDisablementCorruptionDuringPrinterProbeNeverPublishesCompleteEmptyInventory(t *testing.T) {
	a := newTestAgent(t, "local", &fakePrinter{})
	p := &corruptRegistryOnStatus{registryPath: a.registryPath}
	a.printers["local"] = p
	observations := make(chan bool, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path != "/api/agent/heartbeat" {
			http.NotFound(w, req)
			return
		}
		var body struct {
			InventoryComplete bool                     `json:"inventoryComplete"`
			Printers          []map[string]interface{} `json:"printers"`
		}
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if len(body.Printers) > 0 {
			t.Errorf("untrusted local disablement exposed printers: %+v", body.Printers)
		}
		observations <- body.InventoryComplete
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success":true,"desiredState":[]}`))
	}))
	defer server.Close()
	a.cfg.Server.URL = server.URL
	a.sendHeartbeatContext(context.Background())
	if p.writeErr != nil {
		t.Fatalf("fixture could not simulate registry corruption: %v", p.writeErr)
	}
	select {
	case complete := <-observations:
		if complete {
			t.Fatal("heartbeat claimed a complete empty inventory after the policy became unreadable during Status()")
		}
	default:
		t.Fatal("heartbeat failed to report incomplete inventory after the policy read race")
	}
	// A failed policy read cannot authorize another printer dispatch, even
	// if the previously constructed backend is still held in Agent memory.
	if _, err := printer.LoadLocalPrinterDisablement(a.cfg, a.registryPath); err == nil {
		t.Fatal("test fixture unexpectedly recovered the corrupted local registry")
	}
}
