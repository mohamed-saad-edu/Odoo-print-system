package printer

import (
	"context"
	"strings"
	"testing"
)

func TestOutputEvidenceCannotCrossInvocationOrTerminalBoundary(t *testing.T) {
	ctx, first := WithOutputEvidence(context.Background())
	evidence := OutputEvidence{OutputMedium: "file", ArtifactID: "one", SHA256: strings.Repeat("a", 64), PageCount: 2, Bytes: 100}
	if !recordOutputEvidence(ctx, evidence) {
		t.Fatal("valid evidence rejected")
	}
	next, second := WithOutputEvidence(ctx)
	if second.Snapshot() != nil {
		t.Fatal("next invocation inherited an earlier artifact")
	}
	if first.Close().ArtifactID != "one" {
		t.Fatal("first result lost")
	}
	evidence.ArtifactID = "late"
	if recordOutputEvidence(ctx, evidence) {
		t.Fatal("late worker changed terminal evidence")
	}
	if !recordOutputEvidence(next, evidence) || second.Close().ArtifactID != "late" {
		t.Fatal("new invocation evidence unavailable")
	}
	copy := first.Snapshot()
	copy.ArtifactID = "mutated"
	if first.Snapshot().ArtifactID != "one" {
		t.Fatal("caller mutated saved evidence")
	}
}

func TestOutputEvidenceValidationRejectsUnboundedOrPathBearingRecords(t *testing.T) {
	valid := OutputEvidence{OutputMedium: "file", ArtifactID: "opaque", SHA256: strings.Repeat("a", 64), PageCount: 1, Bytes: 100}
	if err := ValidateOutputEvidence(&valid); err != nil {
		t.Fatal(err)
	}
	if ValidateOutputEvidence(nil) == nil {
		t.Fatal("missing file result evidence accepted")
	}
	for _, change := range []func(*OutputEvidence){
		func(e *OutputEvidence) { e.OutputMedium = "physical" }, func(e *OutputEvidence) { e.ArtifactID = "../private/path" }, func(e *OutputEvidence) { e.ArtifactID = "C:\\private.pdf" }, func(e *OutputEvidence) { e.SHA256 = strings.Repeat("A", 64) }, func(e *OutputEvidence) { e.PageCount = 10001 }, func(e *OutputEvidence) { e.Bytes = MaxPDFOutputBytes + 1 }, func(e *OutputEvidence) { e.Bytes = 0 },
	} {
		candidate := valid
		change(&candidate)
		if ValidateOutputEvidence(&candidate) == nil {
			t.Fatalf("unsafe evidence accepted: %+v", candidate)
		}
	}
}
