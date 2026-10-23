package agent

import (
	"bytes"
	"fmt"
	"os"
	"strings"
	"testing"
)

func TestDesiredStateRejectsCumulativeBudgetBeforeLiveMutation(t *testing.T) {
	ag := newDesiredStateTestAgent(t)
	ag.desiredStateSynced = true
	kept := testDesiredPrinter("kept", 1, "disabled")
	ag.desiredStates[kept.ID] = desiredPrinterRecord{Desired: kept, AppliedDesiredRevision: 1, ObservedDesiredRevision: 1}
	ag.gatewayOwned[kept.ID] = struct{}{}
	// Each historical ID fits a wire snapshot. Their cumulative deletion
	// history leaves less than one new two-MiB record of durable capacity.
	for i := 0; i < 15; i++ {
		ag.gatewayTombstones[fmt.Sprintf("%02d-", i)+strings.Repeat("t", 1<<20)] = struct{}{}
	}
	if err := ag.persistDesiredState(); err != nil {
		t.Fatalf("persist bounded starting state: %v", err)
	}
	before, err := os.ReadFile(ag.desiredStatePath)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		next := testDesiredPrinter("next", int64(i+2), "disabled")
		next.ID = fmt.Sprintf("next-%d-", i) + strings.Repeat("n", 2<<20)
		if ag.reconcileGatewayDesiredState([]desiredPrinterWire{next}) {
			t.Fatal("accepted a snapshot whose cumulative desired state cannot be persisted")
		}
		if ag.desiredStateSynced {
			t.Error("rejected snapshot left Gateway execution enabled")
		}
		if len(ag.desiredStates) != 1 || ag.desiredStates[kept.ID].Desired.ID != kept.ID {
			t.Errorf("rejected snapshot %d changed live desired records", i)
		}
		if len(ag.gatewayTombstones) != 15 {
			t.Errorf("rejected snapshot %d grew deletion history to %d entries", i, len(ag.gatewayTombstones))
		}
		if _, ok := ag.gatewayOwned[kept.ID]; !ok || len(ag.gatewayOwned) != 1 {
			t.Errorf("rejected snapshot %d changed live Gateway ownership", i)
		}
	}
	after, err := os.ReadFile(ag.desiredStatePath)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("rejected desired state changed the durable snapshot: err=%v", err)
	}
}
