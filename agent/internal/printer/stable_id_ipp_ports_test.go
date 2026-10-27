package printer

import (
	"fmt"
	"net/url"
	"path/filepath"
	"testing"
)

func TestIPPIdentityDefaultsMatchExecutionPort(t *testing.T) {
	for _, tc := range []struct {
		scheme string
		port   int
	}{{"ipp", 631}, {"ipps", 631}, {"http", 80}, {"https", 443}} {
		t.Run(tc.scheme, func(t *testing.T) {
			implicit := DeviceInfo{ConnectionType: "ipp", Protocol: "ipp", Endpoint: tc.scheme + "://192.168.1.20/ipp/print"}
			explicit := implicit
			explicit.Endpoint = fmt.Sprintf("%s://192.168.1.20:%d/ipp/print", tc.scheme, tc.port)
			backend, err := NewIPPPrinter(implicit.Endpoint, "fixture")
			if err != nil {
				t.Fatal(err)
			}
			uri, err := url.Parse(backend.PrinterURI)
			if err != nil || uri.Port() != fmt.Sprint(tc.port) {
				t.Fatalf("execution URI=%q err=%v", backend.PrinterURI, err)
			}
			if StableIDForDevice(implicit) != StableIDForDevice(explicit) {
				t.Fatalf("same execution endpoint has different IDs: implicit=%s explicit=%s", StableIDForDevice(implicit), StableIDForDevice(explicit))
			}
		})
	}
}

func TestIPPRootResourceIsNotTheDefaultIPPPrintQueue(t *testing.T) {
	const host = "192.168.1.20"
	root := StableIDFromIPPURI("ipp://192.168.1.20:631/", host, 631)
	implicitRoot := StableIDFromIPPURI("ipp://192.168.1.20:631", host, 631)
	defaultQueue := StableIDFromIPPURI("ipp://192.168.1.20:631/ipp/print", host, 631)
	if root != implicitRoot || root == defaultQueue {
		t.Fatalf("root URI must remain one identity, distinct from /ipp/print: root=%s implicit=%s default=%s", root, implicitRoot, defaultQueue)
	}
	device := DeviceInfo{
		ConnectionType: "ipp", Protocol: "ipp", Endpoint: "ipp://192.168.1.20:631/",
		Capabilities: map[string]interface{}{"serial": "queue-server-123"},
	}
	rootKey, rootOK := physicalIdentityKey(device)
	device.Endpoint = "ipp://192.168.1.20:631/ipp/print"
	defaultKey, defaultOK := physicalIdentityKey(device)
	if !rootOK || !defaultOK || rootKey == defaultKey {
		t.Fatalf("strong hardware evidence cannot erase the IPP queue resource: root=%q default=%q", rootKey, defaultKey)
	}
}

func TestManualIPPPortsRemainSeparateDestinations(t *testing.T) {
	for _, tc := range []struct {
		scheme    string
		otherPort int
	}{{"ipps", 443}, {"http", 631}} {
		t.Run(tc.scheme, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "printers.json")
			endpoints := []string{tc.scheme + "://192.168.1.20/ipp/print", fmt.Sprintf("%s://192.168.1.20:%d/ipp/print", tc.scheme, tc.otherPort)}
			var rows []DeviceInfo
			for _, endpoint := range endpoints {
				var err error
				rows, err = RegisterManual(path, DeviceInfo{Name: "Office", ConnectionType: "ipp", Protocol: "ipp", Endpoint: endpoint, Enabled: true})
				if err != nil {
					t.Fatal(err)
				}
			}
			if len(rows) != 2 {
				t.Fatalf("different physical destinations collapsed to %d registry rows: %+v", len(rows), rows)
			}
			seen := map[string]bool{}
			for _, row := range rows {
				seen[row.Endpoint] = true
			}
			for _, endpoint := range endpoints {
				if !seen[endpoint] {
					t.Fatalf("registration overwrote destination %q", endpoint)
				}
			}
		})
	}
}

func TestIPPDefaultResourceIdentifiesSeparateSecureTransport(t *testing.T) {
	// Both endpoints reach /ipp/print on port 631, but TLS and plaintext
	// are distinct execution authorities. Auto-discovery must never assign
	// the same registry ID and silently replace a queue's security binding.
	plain := StableIDFromIPPURI("ipp://192.168.1.20:631/ipp/print", "192.168.1.20", 631)
	secure := StableIDFromIPPURI("ipps://192.168.1.20:631/ipp/print", "192.168.1.20", 631)
	if plain == secure {
		t.Fatalf("IPP and IPPS endpoints collided at stable ID %q", plain)
	}
	if want := StableIDFromNetwork("192.168.1.20", 631); plain != want {
		t.Fatalf("historical plain IPP scan ID changed: got %q want %q", plain, want)
	}
	if got := StableIDFromIPPURI("https://192.168.1.20:631/ipp/print", "192.168.1.20", 631); got != secure {
		t.Fatalf("same secure destination changed identity when using HTTPS spelling: %q vs %q", secure, got)
	}
}
