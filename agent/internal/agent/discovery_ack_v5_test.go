package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/yaseir-agent/agent/internal/config"
)

func TestDiscoveryPaginationRequiresCompletePositiveAcknowledgment(t *testing.T) {
	// The Gateway returns a bounded array of rejected observations, not a
	// numeric skipped count. A partially accepted page can exceed the small
	// error-detail limit while still being a complete valid acknowledgement.
	skipped := make([]map[string]string, discoveryReportMaxDevices-1)
	for i := range skipped {
		skipped[i] = map[string]string{"id": fmt.Sprintf("device-%032d", i), "reason": "ipAddress must be a valid private/local network address"}
	}
	partialBody, err := json.Marshal(map[string]interface{}{"ok": true, "inserted": 1, "updated": 0, "skipped": skipped, "verification": "candidate-only"})
	if err != nil {
		t.Fatal(err)
	}
	if len(partialBody) <= maxGatewayErrorBodyBytes {
		t.Fatal("fixture must exceed the diagnostic error-body limit")
	}
	for _, tc := range []struct {
		name, body string
		readError  bool
	}{
		{"empty", "", false},
		{"negative", `{"ok":false}`, false},
		{"missing", `{}`, false},
		{"wrong_type", `{"ok":"true"}`, false},
		{"null", `null`, false},
		{"trailing_value", `{"ok":true}true`, false},
		{"oversized", `{"ok":true}` + strings.Repeat(" ", 2<<20), false},
		{"incomplete_transfer", `{"ok":true}`, true},
		{"positive", `{"ok":true,"inserted":250,"updated":0,"skipped":[],"verification":"candidate-only"}`, false},
		{"partial_positive", string(partialBody), false},
		{"partial_incomplete_transfer", string(partialBody), true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			pages := make(chan int, 8)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var page struct {
					ChunkIndex int `json:"chunkIndex"`
				}
				if err := json.NewDecoder(r.Body).Decode(&page); err != nil {
					t.Errorf("decode real discovery request: %v", err)
				}
				pages <- page.ChunkIndex
				if page.ChunkIndex == 0 {
					if tc.readError {
						w.Header().Set("Content-Length", fmt.Sprint(len(tc.body)+1024))
					}
					_, _ = w.Write([]byte(tc.body))
					return
				}
				_, _ = w.Write([]byte(`{"ok":true}`))
			}))
			defer server.Close()
			cfg := &config.Config{}
			cfg.Server.URL = server.URL
			a := &Agent{cfg: cfg, client: server.Client()}
			devices := make([]map[string]interface{}, discoveryReportMaxDevices+1)
			for i := range devices {
				devices[i] = map[string]interface{}{"id": fmt.Sprintf("device_%d", i)}
			}
			a.reportDiscoveryResult(context.Background(), "session", "completed", devices)
			want := 1
			if tc.name == "positive" || tc.name == "partial_positive" {
				want = 2
			}
			if got := len(pages); got != want {
				t.Fatalf("discovery sent %d pages, want %d; unusable acknowledgment must not advance to the terminal page", got, want)
			}
		})
	}
}
