package agent

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/yaseir-agent/agent/internal/config"
	"github.com/yaseir-agent/agent/internal/printer"
)

func TestTerminalDuplicateKeepsOriginalClaimAfterAck(t *testing.T) {
	var token string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		token, _ = body["claimToken"].(string)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "status": body["status"]})
	}))
	defer server.Close()
	p := &fakePrinter{}
	a := newTestAgent(t, "p1", p)
	a.cfg.Server.URL = server.URL
	if err := a.queue.BeginPrint("durable-result", "p1", []byte("document"), "original-execution-claim", false); err != nil {
		t.Fatal(err)
	}
	if err := a.queue.UpdateTerminalWithEvidence("durable-result", "success", "", "spool-1"); err != nil {
		t.Fatal(err)
	}
	if err := a.queue.ClearClaimToken("durable-result", "original-execution-claim"); err != nil {
		t.Fatal(err)
	}
	job := dispatchTestJob("durable-result", "p1")
	job["claimToken"] = "unrelated-new-claim"
	a.processJob(context.Background(), job)
	if token != "original-execution-claim" {
		t.Fatalf("durable terminal result adopted a different execution claim: %q", token)
	}
	if p.Calls() != 0 {
		t.Fatal("duplicate terminal delivery executed output again")
	}
}

func actualFileReplayPDF() []byte {
	var b bytes.Buffer
	b.WriteString("%PDF-1.4\n")
	objects := []string{"<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.276 841.89] /Contents 4 0 R >>", "<< /Length 0 >>\nstream\n\nendstream"}
	offsets := []int{0}
	for i, object := range objects {
		offsets = append(offsets, b.Len())
		fmt.Fprintf(&b, "%d 0 obj\n%s\nendobj\n", i+1, object)
	}
	xref := b.Len()
	fmt.Fprintf(&b, "xref\n0 %d\n0000000000 65535 f \n", len(offsets))
	for _, offset := range offsets[1:] {
		fmt.Fprintf(&b, "%010d 00000 n \n", offset)
	}
	fmt.Fprintf(&b, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(offsets), xref)
	return b.Bytes()
}

func TestActualPDFOutputReplaysDurableEvidenceWithoutCreatingAnotherFile(t *testing.T) {
	var mu sync.Mutex
	var successes []map[string]interface{}
	rejectFirst := true
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			http.Error(w, "bad fixture request", 400)
			return
		}
		mu.Lock()
		defer mu.Unlock()
		if body["status"] == "success" {
			successes = append(successes, body)
			if rejectFirst {
				rejectFirst = false
				http.Error(w, "simulated acknowledgement loss", 503)
				return
			}
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "status": body["status"]})
	}))
	defer server.Close()
	outputDir := t.TempDir()
	cfgPath := filepath.Join(t.TempDir(), "config.yaml")
	cfg := &config.Config{PDFOutputProfiles: map[string]config.PDFOutputProfile{"approved": {Directory: outputDir}}, Printers: []config.PrinterConfig{{ID: "pdf-local", Name: "Approved PDF output", Type: "pdf_output", Protocol: "pdf", PrinterType: "file", OutputProfileID: "approved", Endpoint: "pdf-output:approved"}}}
	cfg.Agent.ID, cfg.Agent.Secret, cfg.Server.URL = "agt_test", "test-local-secret", server.URL
	a, err := New(cfg, cfgPath)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	pc, err := cfg.ResolvePDFOutput(cfg.Printers[0])
	if err != nil {
		t.Fatal(err)
	}
	// A cold embedded renderer can outlive the first five-second live probe,
	// especially under the race detector. Eligibility must wait for a later
	// real read-only proof; initialization never authorizes or creates output.
	readyCtx, cancelReady := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancelReady()
	for {
		_, probeErr := printer.ProbeOperationalVerification(readyCtx, a.printers["pdf-local"], pc)
		if probeErr == nil {
			break
		}
		select {
		case <-readyCtx.Done():
			t.Fatalf("actual PDF destination never became verified: %v", probeErr)
		case <-time.After(100 * time.Millisecond):
		}
	}
	if files, readErr := os.ReadDir(outputDir); readErr != nil || len(files) != 0 {
		t.Fatalf("read-only eligibility verification created output: files=%v err=%v", files, readErr)
	}
	job := dispatchTestJob("file-creation-once", "pdf-local")
	job["bindingDigest"] = testPrinterBinding(pc)
	data := actualFileReplayPDF()
	job["payload"] = map[string]interface{}{"type": "pdf", "encoding": "base64", "data": base64.StdEncoding.EncodeToString(data)}
	inventory := a.printerStatusPayload()
	if len(inventory) != 1 || inventory[0]["printerType"] != "file" {
		t.Fatalf("approved output not represented as file: %+v", inventory)
	}
	inventoryJSON, _ := json.Marshal(inventory)
	if strings.Contains(string(inventoryJSON), outputDir) {
		t.Fatal("private output directory leaked into Gateway inventory")
	}
	a.processJob(context.Background(), job)
	reports, err := a.queue.PendingTerminalReports(4)
	if err != nil || len(reports) != 1 || reports[0].OutputEvidence == "" || reports[0].Status != "success" {
		t.Fatalf("lost acknowledgement did not retain file evidence: %+v %v", reports, err)
	}
	if err := a.Close(); err != nil {
		t.Fatal(err)
	}
	b, err := New(cfg, cfgPath)
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	b.reportPendingTerminalStatuses(context.Background())
	job["claimToken"] = "unrelated-later-delivery"
	b.processJob(context.Background(), job)
	files, err := os.ReadDir(outputDir)
	if err != nil || len(files) != 1 || !strings.HasSuffix(files[0].Name(), ".pdf") {
		t.Fatalf("replay created extra output: %v %v", files, err)
	}
	actual, err := os.ReadFile(filepath.Join(outputDir, files[0].Name()))
	if err != nil || !bytes.Equal(actual, data) {
		t.Fatalf("created output differs from admitted PDF: %v", err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(successes) != 3 {
		t.Fatalf("expected initial, restarted outbox and duplicate result reports: %+v", successes)
	}
	for _, report := range successes {
		if report["claimToken"] != "claim-file-creation-once" || report["transport"] != "pdf_output" || !reflect.DeepEqual(report["outputEvidence"], successes[0]["outputEvidence"]) {
			t.Fatalf("replay changed original file result or claim: %+v", report)
		}
	}
	evidence, ok := successes[0]["outputEvidence"].(map[string]interface{})
	if !ok {
		t.Fatalf("missing actual output proof: %+v", successes[0])
	}
	digest := sha256.Sum256(actual)
	if evidence["sha256"] != hex.EncodeToString(digest[:]) || evidence["bytes"] != float64(len(actual)) || evidence["page_count"] != float64(1) || evidence["artifact_id"] != strings.TrimSuffix(files[0].Name(), ".pdf") {
		t.Fatalf("file proof does not identify actual output: %+v", evidence)
	}
}
