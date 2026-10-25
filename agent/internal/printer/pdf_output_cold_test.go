package printer

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"testing"
	"time"
)

func TestPDFOutputColdVerificationRecoversAfterCanceledFirstProbe(t *testing.T) {
	const marker = "YASEIR_TEST_PDF_COLD_VERIFICATION_CHILD"
	if os.Getenv(marker) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 150*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestPDFOutputColdVerificationRecoversAfterCanceledFirstProbe$", "-test.v")
		command.Env = append(os.Environ(), marker+"=1")
		output, err := command.CombinedOutput()
		t.Logf("fresh-process cold verification evidence:\n%s", output)
		if err != nil {
			t.Fatalf("cold verification subprocess failed: %v", err)
		}
		return
	}
	dir := t.TempDir()
	pc := approvedPDFOutputConfig(t, dir)
	backend, err := New(pc)
	if err != nil {
		t.Fatal(err)
	}
	first, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	started := time.Now()
	proof, err := ProbeOperationalVerification(first, backend, pc)
	elapsed := time.Since(started)
	cancel()
	if proof != nil || err == nil {
		t.Fatalf("canceled cold probe incorrectly verified: %+v %v", proof, err)
	}
	if elapsed > 2*time.Second {
		t.Errorf("canceled live probe remained blocked by cold renderer initialization: %s", elapsed)
	}
	files, readErr := os.ReadDir(dir)
	if readErr != nil || len(files) != 0 {
		t.Fatalf("canceled probe left output: %v %v", files, readErr)
	}
	deadline := time.Now().Add(100 * time.Second)
	attempts := 0
	for time.Now().Before(deadline) {
		attempts++
		proof, err = ProbeOperationalVerification(context.Background(), backend, pc)
		if err == nil {
			break
		}
		if !errors.Is(err, context.DeadlineExceeded) && !errors.Is(err, ErrPrinterUnverified) {
			t.Fatal(err)
		}
	}
	files, readErr = os.ReadDir(dir)
	if err != nil || proof == nil || proof.OutputMedium != "file" || readErr != nil || len(files) != 0 {
		t.Fatalf("same pool did not recover after canceled cold probe: %+v %v files=%v read=%v", proof, err, files, readErr)
	}
	t.Logf("first_probe_ms=%d later_probe_attempts=%d verified_file_service=true retained_output_files=%d", elapsed.Milliseconds(), attempts, len(files))
}
