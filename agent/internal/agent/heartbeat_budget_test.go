package agent

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// An item that cannot fit by itself must reject the snapshot rather than be
// moved to another page forever. The timeout bounds the pre-fix regression.
func TestHeartbeatRejectsUnsplittableOversizedData(t *testing.T) {
	large := strings.Repeat("x", maxHeartbeatEnvelopeBytes)
	for _, tc := range []struct {
		name     string
		printers []map[string]interface{}
		acks     []map[string]interface{}
		private  []string
		keep     []map[string]string
	}{
		{name: "common keepalive", acks: []map[string]interface{}{{"id": "p1"}}, keep: []map[string]string{{"jobId": "job1", "claimToken": large}}},
		{name: "desired acknowledgement", acks: []map[string]interface{}{{"id": large}}},
		{name: "private identifier", private: []string{large}},
		{name: "printer metadata", printers: []map[string]interface{}{{"id": "p1", "name": large}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			done := make(chan []map[string]interface{}, 1)
			go func() {
				done <- buildHeartbeatPayloadPages(tc.printers, tc.acks, nil, tc.private, tc.keep, true)
			}()
			select {
			case pages := <-done:
				if len(pages) != 0 {
					t.Fatalf("unsplittable data produced %d heartbeat pages; want snapshot rejection", len(pages))
				}
			case <-time.After(time.Second):
				t.Fatal("heartbeat pagination did not terminate for unsplittable data")
			}
		})
	}
}

func TestHeartbeatSplitsAuxiliaryDataThatFitsSeparately(t *testing.T) {
	ackID := strings.Repeat("a", 50*1024)
	privateID := strings.Repeat("p", 50*1024)
	pages := buildHeartbeatPayloadPages(nil, []map[string]interface{}{{"printerId": ackID}}, nil,
		[]string{privateID}, []map[string]string{{"jobId": "job1", "claimToken": strings.Repeat("k", 430*1024)}}, true)
	if len(pages) != 2 {
		t.Fatalf("individually bounded auxiliary records need two pages, got %d", len(pages))
	}
	acks, private := 0, 0
	for _, page := range pages {
		encoded, err := json.Marshal(page)
		if err != nil || len(encoded) > maxHeartbeatEnvelopeBytes {
			t.Fatalf("invalid heartbeat page: bytes=%d, err=%v", len(encoded), err)
		}
		for _, ack := range page["desiredStateAcks"].([]map[string]interface{}) {
			if ack["printerId"] != ackID {
				t.Fatal("desired-state acknowledgement changed during pagination")
			}
			acks++
		}
		if ids, ok := page["privatePrinterIds"].([]string); ok {
			for _, id := range ids {
				if id != privateID {
					t.Fatal("private printer identity changed during pagination")
				}
				private++
			}
		}
	}
	if acks != 1 || private != 1 {
		t.Fatalf("pagination lost or duplicated auxiliary records: acks=%d private=%d", acks, private)
	}
}

func TestHeartbeatRejectedSnapshotRetainsLifecycleFence(t *testing.T) {
	ag := newDesiredStateTestAgent(t)
	ag.desiredStates[strings.Repeat("x", maxHeartbeatEnvelopeBytes)] = desiredPrinterRecord{}
	ag.execFence.Store(true)
	done := make(chan struct{})
	go func() {
		ag.sendHeartbeatContext(context.Background())
		close(done)
	}()
	select {
	case <-done:
		if !ag.execFence.Load() {
			t.Fatal("rejected heartbeat cleared the lifecycle fence without a Gateway acknowledgement")
		}
	case <-time.After(time.Second):
		t.Fatal("heartbeat did not return after rejecting an unsplittable snapshot")
	}
}
