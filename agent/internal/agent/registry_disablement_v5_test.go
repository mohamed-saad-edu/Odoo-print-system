package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/yaseir-agent/agent/internal/config"
	"github.com/yaseir-agent/agent/internal/printer"
)

func newRegistryDisablementAgent(t *testing.T, cfg *config.Config, devices []printer.DeviceInfo) *Agent {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := printer.SaveRegistry(config.RegistryPath(path), devices); err != nil {
		t.Fatal(err)
	}
	a, err := New(cfg, path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = a.Close() })
	completeDisablementTestSync(t, a)
	return a
}

func completeDisablementTestSync(t *testing.T, a *Agent) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/api/agent/heartbeat" {
			_, _ = w.Write([]byte(`{"success":true,"desiredState":[]}`))
			return
		}
		var body map[string]interface{}
		_ = json.NewDecoder(r.Body).Decode(&body)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "status": body["status"]})
	}))
	t.Cleanup(server.Close)
	a.cfg.Agent.ID, a.cfg.Agent.Secret, a.cfg.Server.URL = "agt_test", "secret", server.URL
	// Startup/reconciliation remain real; only status/output touch a controlled
	// transport, so these tests never probe a LAN printer or native driver.
	for id := range a.printers {
		a.printers[id] = &fakePrinter{}
	}
	a.sendHeartbeatContext(context.Background())
	if !a.desiredStateSynced {
		t.Fatal("actual empty Gateway desired-state response was not synchronized")
	}
}

func TestPersistedDisabledPrinterDoesNotEnterRuntime(t *testing.T) {
	for _, transport := range []string{"network", "ipp", "pdf_output"} {
		t.Run(transport, func(t *testing.T) {
			device := productionNetworkDevice("local", "10.0.0.20:9100")
			device.Enabled = false
			cfg := &config.Config{}
			switch transport {
			case "ipp":
				device.ConnectionType, device.Protocol, device.Endpoint = "ipp", "ipp", "ipp://10.0.0.20/ipp/print"
			case "pdf_output":
				device.ConnectionType, device.Protocol, device.PrinterType = "pdf_output", "pdf", "file"
				device.Endpoint, device.OutputProfileID = "pdf-output:approved", "approved"
				cfg.PDFOutputProfiles = map[string]config.PDFOutputProfile{"approved": {Directory: t.TempDir()}}
			}
			a := newRegistryDisablementAgent(t, cfg, []printer.DeviceInfo{device})
			if _, exists := a.getPrinter(device.ID); exists {
				t.Error("valid persisted enabled:false became an executable backend during startup")
			}
			if a.isPrinterExecutionAllowed(device.ID) {
				t.Error("empty desired-state sync authorized a locally disabled printer")
			}
			rows, err := printer.LoadRegistryPrinters(a.registryPath)
			if err != nil || len(rows) != 1 || rows[0].Enabled {
				t.Fatalf("startup lost durable disablement: rows=%+v err=%v", rows, err)
			}
		})
	}
}

func TestRegistryDisablementFencesLiveJobAndGatewayAlias(t *testing.T) {
	for _, requestedID := range []string{"local", "local~abcdef12"} {
		t.Run(requestedID, func(t *testing.T) {
			cfg := &config.Config{}
			device := productionNetworkDevice("local", "10.0.0.20:9100")
			a := newRegistryDisablementAgent(t, cfg, []printer.DeviceInfo{device})
			if strings.Contains(requestedID, "~") {
				requestedID = gatewayAliasPrinterID(device.ID, a.cfg.Agent.ID)
			}
			p := &fakePrinter{}
			a.printers[device.ID] = p // only replace the transport boundary
			a.processJob(context.Background(), dispatchTestJob("before-disable", requestedID))
			if p.Calls() != 1 || !a.queue.IsProcessed("before-disable") {
				t.Fatal("enabled control did not reach the verified transport")
			}
			device.Enabled = false
			if err := printer.SaveRegistry(a.registryPath, []printer.DeviceInfo{device}); err != nil {
				t.Fatal(err)
			}
			// No heartbeat/reload: an operator change must be read at physical admission.
			a.processJob(context.Background(), dispatchTestJob("after-disable", requestedID))
			if p.Calls() != 1 || a.queue.IsProcessed("after-disable") || a.queue.WasOutcomeUnknown("after-disable") {
				t.Fatalf("persisted disablement admitted output or invented an ambiguous result: calls=%d", p.Calls())
			}
		})
	}
}

func TestRegistryDisablementWithdrawsRuntimeAndProof(t *testing.T) {
	for _, managed := range []bool{false, true} {
		t.Run(map[bool]string{false: "local", true: "gateway-alias"}[managed], func(t *testing.T) {
			device := productionNetworkDevice("local", "192.168.2.10:9100")
			a := newRegistryDisablementAgent(t, &config.Config{}, []printer.DeviceInfo{device})
			id := device.ID
			if managed {
				id = "cloud-alias"
				if !a.reconcileGatewayDesiredState([]desiredPrinterWire{testDesiredPrinter(id, 1, "active")}) {
					t.Fatal("enabled desired-state control failed")
				}
			}
			for runtimeID := range a.printers {
				a.printers[runtimeID] = &fakePrinter{}
			}
			if rows := a.printerStatusPayload(); len(rows) == 0 {
				t.Fatal("enabled control did not publish operational inventory")
			}
			device.Enabled = false
			if err := printer.SaveRegistry(a.registryPath, []printer.DeviceInfo{device}); err != nil {
				t.Fatal(err)
			}
			if rows := a.printerStatusPayload(); len(rows) != 0 {
				t.Errorf("disabled binding still published live status/operational proof: %+v", rows)
			}
			a.reloadRegistryPrinters()
			if _, exists := a.getPrinter(id); exists {
				t.Error("disabled runtime remained after registry reconciliation")
			}
			if managed {
				a.reconcileGatewayDesiredState([]desiredPrinterWire{testDesiredPrinter(id, 1, "active")})
				if _, exists := a.getPrinter(id); exists {
					t.Error("unchanged remote active revision restored disabled local binding")
				}
			}
		})
	}
}

func TestRegistryDisablementOutranksDesiredStateByIDAndBinding(t *testing.T) {
	for _, relation := range []string{"exact-id", "gateway-suffix", "gateway-suffix-other-binding", "explicit-local-suffix-other-binding", "same-binding", "same-name-other-binding"} {
		t.Run(relation, func(t *testing.T) {
			device := productionNetworkDevice("local", "192.168.2.10:9100")
			device.Enabled = false
			devices := []printer.DeviceInfo{device}
			if relation == "explicit-local-suffix-other-binding" {
				devices = append(devices, productionNetworkDevice("local~abcdef12", "192.168.2.11:9100"))
			}
			a := newRegistryDisablementAgent(t, &config.Config{}, devices)
			row := testDesiredPrinter("cloud-alias", 1, "active")
			row.Name = device.Name
			switch relation {
			case "exact-id":
				row.ID = device.ID
				row.Config["ip"] = "192.168.2.11" // an ID rename cannot erase a local disablement
			case "gateway-suffix":
				row.ID = device.ID + "~abcdef12"
			case "gateway-suffix-other-binding", "explicit-local-suffix-other-binding":
				row.ID = device.ID + "~abcdef12"
				row.Config["ip"] = "192.168.2.11"
			case "same-name-other-binding":
				row.Config["ip"] = "192.168.2.11"
			}
			a.reconcileGatewayDesiredState([]desiredPrinterWire{row})
			_, exists := a.getPrinter(row.ID)
			if relation == "same-name-other-binding" || relation == "explicit-local-suffix-other-binding" {
				if !exists || a.desiredStates[row.ID].ApplyError != "" {
					t.Fatal("a shared display name disabled unrelated hardware")
				}
			} else if exists || !strings.Contains(a.desiredStates[row.ID].ApplyError, "disabled") {
				t.Fatalf("remote active state overrode persisted local disablement: runtime=%v record=%+v", exists, a.desiredStates[row.ID])
			}
		})
	}
}

func TestRegistryDisablementAndYAMLAuthority(t *testing.T) {
	for _, source := range []string{"registry", "yaml"} {
		t.Run(source, func(t *testing.T) {
			device := productionNetworkDevice("local", "10.0.0.20:9100")
			enabled := source != "yaml"
			device.Enabled = source != "registry"
			pc := config.PrinterConfig{ID: device.ID, Name: device.Name, Type: "network", Protocol: "raw", Endpoint: device.Endpoint, Enabled: &enabled}
			a := newRegistryDisablementAgent(t, &config.Config{Printers: []config.PrinterConfig{pc}}, []printer.DeviceInfo{device})
			if a.isPrinterExecutionAllowed(device.ID) {
				t.Fatalf("explicit %s disablement was overridden by the other local source", source)
			}
			if _, exists := a.getPrinter(device.ID); exists {
				t.Errorf("explicit %s disablement retained an executable backend", source)
			}
		})
	}
}

func TestLegacyRegistryOmittedEnabledRemainsUsable(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	legacy := `[{"id":"legacy","name":"Receipt","printerType":"thermal","connectionType":"network","protocol":"raw","endpoint":"10.0.0.20:9100"}]`
	if err := os.WriteFile(config.RegistryPath(path), []byte(legacy), 0600); err != nil {
		t.Fatal(err)
	}
	a, err := New(&config.Config{}, path)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	completeDisablementTestSync(t, a)
	if _, exists := a.getPrinter("legacy"); !exists || !a.isPrinterExecutionAllowed("legacy") {
		t.Fatal("legacy registry without an enabled property lost its enabled default")
	}
}

func TestRegisterDisabledPrinterPersistsWithoutRuntime(t *testing.T) {
	a := newRegistryDisablementAgent(t, &config.Config{}, nil)
	device := productionNetworkDevice("disabled-manual", "10.0.0.20:9100")
	device.Enabled = false
	if err := a.RegisterManual(device); err != nil {
		t.Fatalf("disabled registration should persist successfully: %v", err)
	}
	if _, exists := a.getPrinter(device.ID); exists {
		t.Fatal("disabled manual registration created an executable backend")
	}
	rows, err := printer.LoadRegistryPrinters(a.registryPath)
	if err != nil || len(rows) != 1 || rows[0].Enabled {
		t.Fatalf("disabled manual registration was not preserved: rows=%+v err=%v", rows, err)
	}
}

func TestRegistryDisablementDuringClaimACKRefusesActualTCPBytes(t *testing.T) {
	for _, disableACK := range []int32{1, 2} {
		t.Run(fmt.Sprintf("ACK-%d", disableACK), func(t *testing.T) {
			listener, err := net.Listen("tcp", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			defer listener.Close()
			bytesRead := make(chan int, 1)
			go func() {
				conn, err := listener.Accept()
				if err != nil {
					bytesRead <- -1
					return
				}
				defer conn.Close()
				_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
				data, _ := io.ReadAll(conn)
				bytesRead <- len(data)
			}()
			device := productionNetworkDevice("local", "10.0.0.20:9100")
			a := newRegistryDisablementAgent(t, &config.Config{}, []printer.DeviceInfo{device})
			a.printers[device.ID] = &verifiedNetworkSharingFixture{NetworkPrinter: &printer.NetworkPrinter{Address: listener.Addr().String(), Protocol: "raw"}}
			var printingACKs atomic.Int32
			var persistError atomic.Pointer[error]
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body map[string]interface{}
				_ = json.NewDecoder(r.Body).Decode(&body)
				if body["status"] == "printing" && printingACKs.Add(1) == disableACK {
					disabled := device
					disabled.Enabled = false
					if err := printer.SaveRegistry(a.registryPath, []printer.DeviceInfo{disabled}); err != nil {
						persistError.Store(&err)
					}
				}
				_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "status": body["status"]})
			}))
			defer server.Close()
			a.cfg.Server.URL = server.URL
			a.processJob(context.Background(), dispatchTestJob("late-disable", device.ID))
			if err := persistError.Load(); err != nil {
				t.Fatal(*err)
			}
			select {
			case count := <-bytesRead:
				if count != 0 {
					t.Fatalf("disabled while awaiting claim ACK, but wrote %d TCP bytes", count)
				}
			case <-time.After(6 * time.Second):
				t.Fatal("actual TCP boundary did not close")
			}
			if printingACKs.Load() != disableACK || a.queue.WasOutcomeUnknown("late-disable") {
				t.Fatalf("zero-byte refusal lost its original evidence: ACKs=%d", printingACKs.Load())
			}
		})
	}
}

func TestRegistryDisablementRetainsDetachedWorkerFence(t *testing.T) {
	device := productionNetworkDevice("local", "10.0.0.20:9100")
	a := newRegistryDisablementAgent(t, &config.Config{}, []printer.DeviceInfo{device})
	worker := startRetirementWorker(t)
	a.printers[device.ID] = worker
	device.Enabled = false
	if err := printer.SaveRegistry(a.registryPath, []printer.DeviceInfo{device}); err != nil {
		t.Fatal(err)
	}
	a.reloadRegistryPrinters()
	assertRetiredNotExecutable(t, a, device.ID)
	if a.retiredPrinters[device.ID] != printer.Printer(worker) {
		t.Fatal("local disablement discarded a still-live native generation")
	}
	device.Enabled = true
	if err := printer.SaveRegistry(a.registryPath, []printer.DeviceInfo{device}); err != nil {
		t.Fatal(err)
	}
	a.reloadRegistryPrinters()
	assertRetiredNotExecutable(t, a, device.ID)
	worker.finish()
	a.reloadRegistryPrinters()
	if _, exists := a.getPrinter(device.ID); !exists {
		t.Fatal("explicit re-enable did not recover after actual worker completion")
	}
}

type disableDuringStatusPrinter struct {
	fakePrinter
	onStatus func()
}

func (p *disableDuringStatusPrinter) Status() string {
	p.onStatus()
	return "online"
}

func TestRegistryDisablementDuringProbeCannotPublishProof(t *testing.T) {
	device := productionNetworkDevice("local", "10.0.0.20:9100")
	a := newRegistryDisablementAgent(t, &config.Config{}, []printer.DeviceInfo{device})
	var persistError atomic.Pointer[error]
	a.printers[device.ID] = &disableDuringStatusPrinter{onStatus: func() {
		device.Enabled = false
		if err := printer.SaveRegistry(a.registryPath, []printer.DeviceInfo{device}); err != nil {
			persistError.Store(&err)
		}
	}}
	rows := a.printerStatusPayload()
	if err := persistError.Load(); err != nil {
		t.Fatal(*err)
	}
	if len(rows) != 0 {
		t.Fatal("operator disablement during a probe was published as fresh operational proof")
	}
}

func TestRegistryLockFailureCannotRestoreDisabledDiscovery(t *testing.T) {
	for _, live := range []bool{false, true} {
		t.Run(fmt.Sprintf("live-%v", live), func(t *testing.T) {
			device := productionNetworkDevice("local", "10.0.0.20:9100")
			device.Enabled = false
			a := newRegistryDisablementAgent(t, &config.Config{}, []printer.DeviceInfo{device})
			if err := os.Remove(a.registryPath + ".lock"); err != nil {
				t.Fatal(err)
			}
			if err := os.Mkdir(a.registryPath+".lock", 0700); err != nil {
				t.Fatal(err)
			}
			device.Enabled = true // rediscovery cannot reconstruct saved policy
			var rows []printer.DeviceInfo
			var err error
			if live {
				rows, err = a.persistLiveDiscovery(printer.DiscoveryResult{Printers: []printer.DeviceInfo{device}})
			} else {
				rows, err = a.persistDiscoveredPrinters([]printer.DeviceInfo{device})
			}
			if !errors.Is(err, printer.ErrRegistryUntrusted) || len(rows) != 0 {
				t.Fatalf("unreadable registry lock restored disabled discovery authority: rows=%+v err=%v", rows, err)
			}
		})
	}
}

func TestRegistryDisablementWithholdsCloudDiscoveryProof(t *testing.T) {
	device := productionNetworkDevice("local", "10.0.0.20:9100")
	device.Enabled = false
	a := newRegistryDisablementAgent(t, &config.Config{}, []printer.DeviceInfo{device})
	device.Enabled = true
	device.Status = "online"
	proof, err := (&fakePrinter{}).VerifyOperational(context.Background(), printerConfigFromDeviceInfo(device))
	if err != nil {
		t.Fatal(err)
	}
	device.Capabilities = map[string]interface{}{"operational_verification": proof}
	rows, _ := a.cloudDiscoveryPayload(printer.DiscoveryResult{Printers: []printer.DeviceInfo{device}})
	if len(rows) != 0 {
		t.Fatal("rediscovery published a disabled local binding as operational cloud inventory")
	}
}

func TestRegistryDisablementSurvivesGatewayDeletionAndRecreation(t *testing.T) {
	device := productionNetworkDevice("local", "10.0.0.20:9100")
	device.Enabled = false
	a := newRegistryDisablementAgent(t, &config.Config{}, []printer.DeviceInfo{device})
	desired := testDesiredPrinter(device.ID, 1, "active")
	desired.Config["ip"] = "10.0.0.20"
	if !a.reconcileGatewayDesiredState([]desiredPrinterWire{desired}) {
		t.Fatal("denied desired state must still be recorded")
	}
	if _, exists := a.getPrinter(device.ID); exists {
		t.Fatal("initial local denial did not hold")
	}
	if !a.reconcileGatewayDesiredState(nil) {
		t.Fatal("Gateway deletion must retain its durable tombstone")
	}
	rows, err := printer.LoadRegistryPrinters(a.registryPath)
	if err != nil || len(rows) != 1 || rows[0].ID != device.ID || rows[0].Enabled {
		t.Errorf("remote deletion erased local disablement authority: rows=%+v err=%v", rows, err)
	}
	// A service restart must retain the local denial as well as the Gateway's
	// deletion tombstone; the following remote recreate may remove only the latter.
	if err := a.Close(); err != nil {
		t.Fatal(err)
	}
	a, err = New(a.cfg, a.configPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = a.Close() })
	completeDisablementTestSync(t, a)
	desired.DesiredRevision = 2
	if !a.reconcileGatewayDesiredState([]desiredPrinterWire{desired}) {
		t.Fatal("recreated desired state must still be persisted")
	}
	if !strings.Contains(a.desiredStates[device.ID].ApplyError, "disabled") {
		t.Error("recreated desired state lost the local disabled reason")
	}
	p := &fakePrinter{}
	if _, exists := a.getPrinter(device.ID); exists {
		// Only the transport boundary is controlled. The desired-state apply,
		// status/observation handshake and final dispatch are the real paths.
		a.printers[device.ID] = p
		a.printerStatusPayload()
	}
	a.processJob(context.Background(), dispatchTestJob("remote-recreate", device.ID))
	if p.Calls() != 0 || a.isPrinterExecutionAllowed(device.ID) {
		t.Fatalf("remote delete/recreate restored disabled physical admission: calls=%d", p.Calls())
	}
	// The operator's explicit local remove remains authoritative.
	if err := printer.RemoveFromRegistry(a.registryPath, device.ID); err != nil {
		t.Fatal(err)
	}
	rows, err = printer.LoadRegistryPrinters(a.registryPath)
	if err != nil || len(rows) != 0 {
		t.Fatalf("explicit local removal could not remove a disabled registration: rows=%+v err=%v", rows, err)
	}
}
