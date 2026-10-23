package agent

import (
	"context"
	"testing"
	"time"

	"github.com/yaseir-agent/agent/internal/config"
)

// A native driver can hold the physical execution mutex beyond cancellation.
// Background reconciliation must remain serialized during normal operation,
// but it must release its runtimeWG ownership when the Agent stops.
func TestShutdownCancelsReconciliationPrinterWait(t *testing.T) {
	for _, operation := range []string{"register", "desired_apply", "desired_remove", "registry_remove"} {
		t.Run(operation, func(t *testing.T) {
			a := newDesiredStateTestAgent(t)
			a.shutdownCh = make(chan struct{})
			row := testDesiredPrinter("blocked", 1, "active")
			if !a.reconcileGatewayDesiredState([]desiredPrinterWire{row}) {
				t.Fatal("initialize desired state")
			}
			lock := a.getPrinterLock(row.ID)
			lock.Lock()
			done := make(chan struct{})
			go func() {
				defer close(done)
				switch operation {
				case "register":
					a.addPrinter(row.ID, &fakePrinter{}, config.PrinterConfig{ID: row.ID})
				case "desired_apply":
					_ = a.applyDesiredPrinter(desiredPrinterRecord{Desired: row})
				case "desired_remove":
					a.removeGatewayRuntime(row.ID)
				case "registry_remove":
					a.printersMu.Lock()
					delete(a.gatewayOwned, row.ID)
					a.registryOwned[row.ID] = struct{}{}
					a.printersMu.Unlock()
					a.reconcileRegistryPrinters(nil)
				}
			}()
			// Keeping the execution mutex held is the deterministic fixture;
			// shutdown must never release or bypass a physical worker's mutex.
			select {
			case <-done:
				lock.Unlock()
				t.Fatal("reconciliation bypassed the physical execution lock")
			case <-time.After(20 * time.Millisecond):
			}
			a.beginShutdown()
			select {
			case <-done:
			case <-time.After(time.Second):
				t.Error("reconciliation stayed blocked on physical execution after shutdown")
			}
			lock.Unlock()
			<-done
		})
	}
}

func TestCancelledPrinterWaiterReleasesExecutorReservation(t *testing.T) {
	a := newTestAgent(t, "p1", &fakePrinter{})
	lock := a.getPrinterLock("p1")
	lock.Lock()
	ctx, cancel := context.WithCancel(context.Background())
	if !a.dispatchJob(ctx, dispatchTestJob("cancelled-waiter", "p1")) {
		lock.Unlock()
		t.Fatal("job was not admitted")
	}
	cancel()
	drained := a.waitForJobsFor(time.Second)
	lock.Unlock()
	if !a.waitForJobsFor(time.Second) {
		t.Fatal("fixture did not drain after releasing physical lock")
	}
	if !drained {
		t.Fatal("cancelled waiter retained its executor reservation behind a blocked printer")
	}
	_, status, found, err := a.queue.Get("cancelled-waiter")
	if err != nil || !found || status != "queued" || a.queue.ClaimTokenFor("cancelled-waiter") != "claim-cancelled-waiter" {
		t.Fatalf("cancelled waiter lost its durable pre-dispatch return: status=%s found=%t error=%v", status, found, err)
	}
}

func TestShutdownRuntimeDrainSharesJobGraceDeadline(t *testing.T) {
	a := newTestAgent(t, "p1", &fakePrinter{})
	// A heartbeat probe batch can take time to drain after cancellation.
	// Model a two-second control-plane tail and a native job that outlives it.
	a.launchTracked(func() { <-time.After(2 * time.Second) })
	a.inFlightMu.Lock()
	a.inFlight["native-still-running"] = struct{}{}
	a.inFlightMu.Unlock()
	t.Cleanup(func() {
		a.inFlightMu.Lock()
		delete(a.inFlight, "native-still-running")
		a.inFlightMu.Unlock()
	})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	started := time.Now()
	if err := a.Run(ctx); err != nil {
		t.Fatal(err)
	}
	if elapsed := time.Since(started); elapsed > shutdownGrace+500*time.Millisecond {
		t.Fatalf("runtime drain and jobs each consumed a separate grace: %v exceeds shared %v deadline", elapsed, shutdownGrace)
	}
}

func TestShutdownBoundsStalledRuntimeAndKeepsItsQueueOpen(t *testing.T) {
	a := newTestAgent(t, "p1", &fakePrinter{})
	release, runtimeDone := make(chan struct{}), make(chan struct{})
	// The capture lane's synchronous PDFium metadata calls do not use the
	// request context. Model that exact ownership boundary without a native
	// renderer: the tracked callback can still touch SQLite when it returns.
	a.launchTracked(func() {
		defer close(runtimeDone)
		<-release
		if err := a.queue.Push("late-runtime", "p1", []byte("evidence")); err != nil {
			t.Errorf("live runtime lost its queue before draining: %v", err)
		}
	})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	runDone := make(chan error, 1)
	go func() { runDone <- a.Run(ctx) }()
	select {
	case err := <-runDone:
		if err != nil {
			t.Error(err)
		}
		if err := a.Close(); err != nil {
			t.Error(err)
		}
		if _, err := a.queue.PendingTerminalReports(1); err != nil {
			t.Errorf("shutdown closed queue beneath tracked runtime: %v", err)
		}
	case <-time.After(shutdownGrace + 500*time.Millisecond):
		t.Error("Run waited beyond its shared grace for an uncancellable runtime callback")
		close(release)
		<-runtimeDone
		<-runDone
		return
	}
	close(release)
	<-runtimeDone
	a.runtimeWG.Wait()
	if err := a.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := a.queue.PendingTerminalReports(1); err == nil {
		t.Fatal("drained runtime queue could not be closed on a later Close")
	}
}
