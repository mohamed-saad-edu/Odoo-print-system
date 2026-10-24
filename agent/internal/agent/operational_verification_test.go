package agent

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/yaseir-agent/agent/internal/printer"
)

// Deliberately has no operational-verification implementation.
type unverifiedPrinter struct{ target *fakePrinter }

func (p *unverifiedPrinter) Print(ctx context.Context, data []byte) error {
	return p.target.Print(ctx, data)
}
func (p *unverifiedPrinter) Test(context.Context) error { return nil }
func (p *unverifiedPrinter) Status() string             { return "online" }

func TestV3HeartbeatCannotReplayConfiguredOperationalProof(t *testing.T) {
	a := heartbeatEvidenceAgent(map[string]printer.Printer{"p": &unverifiedPrinter{target: &fakePrinter{}}})
	pc := a.printerConfigs["p"]
	pc.Capabilities["operational_verification"] = map[string]interface{}{
		"version": 1, "verified_at": time.Now().UTC().Format(time.RFC3339),
		"printer_id": "p", "method": "windows_queue",
	}
	a.printerConfigs["p"] = pc
	entry := heartbeatEntry(t, a.printerStatusPayload(), "p")
	if entry["capabilities"].(map[string]interface{})["operational_verification"] != nil {
		t.Fatal("configured text became fresh live operational proof in heartbeat")
	}
}

func TestV3UnverifiedBackendCannotReceiveProductionBytes(t *testing.T) {
	physical := &fakePrinter{}
	a := newTestAgent(t, "p", &unverifiedPrinter{target: physical})
	a.processJob(context.Background(), map[string]interface{}{
		"id": "unverified-operation", "agentId": "agt_test", "printerId": "p",
		"status": "claimed", "claimToken": "claim-unverified-operation",
		"payload":   makeJobPayload("unverified-operation"),
		"expiresAt": time.Now().Add(time.Hour).Format(time.RFC3339), "bindingDigest": testDefaultPrinterBinding(),
	})
	a.waitForJobs()
	if physical.Calls() != 0 {
		t.Fatal("a declared online backend with no actual existence proof received production bytes")
	}
}

func TestV3ClaimCannotChangeItsAdmittedDestination(t *testing.T) {
	for _, binding := range []string{"", strings.Repeat("a", 64)} {
		t.Run("binding-"+binding, func(t *testing.T) {
			physical := &fakePrinter{}
			a := newTestAgent(t, "p", physical)
			job := dispatchTestJob("binding-destination", "p")
			if binding != "" {
				job["bindingDigest"] = binding
			} else {
				delete(job, "bindingDigest")
			}
			a.processJob(context.Background(), job)
			if physical.Calls() != 0 {
				t.Fatal("missing or different admission binding delivered bytes to the current configured destination")
			}
		})
	}
}
