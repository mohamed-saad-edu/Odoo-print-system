package agent

import (
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/yaseir-agent/agent/internal/config"
)

// Heartbeat POST /api/agent/heartbeat validates every privatePrinterIds
// member through src/lib/exact-printer-id.ts (120 UTF-8 bytes), not JS
// string.length/UTF-16 units. A rejected private ID can discard an entire
// negative-sharing snapshot, leaving stale Gateway inventory visible.
func TestPrivatePrinterIDHeartbeatMatchesGatewayUTF8ByteLimit(t *testing.T) {
	tests := []struct {
		name string
		id   string
		want bool
	}{
		{"120 ASCII bytes", strings.Repeat("p", 120), true},
		{"121 ASCII bytes", strings.Repeat("p", 121), false},
		{"60 Arabic letters, 120 bytes", strings.Repeat("ط", 60), true},
		{"61 Arabic letters, 122 bytes", strings.Repeat("ط", 61), false},
		{"30 emoji, 120 bytes", strings.Repeat("😀", 30), true},
		{"31 emoji, 124 bytes", strings.Repeat("😀", 31), false},
		{"noncanonical padded", " printer", false},
		{"newline", "line\nprinter", false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := validGatewaySharingID(tc.id); got != tc.want {
				t.Fatalf("private ID gateway contract mismatch: got %v, want %v, UTF-8 bytes=%d, codepoints=%d",
					got, tc.want, len(tc.id), utf8.RuneCountInString(tc.id))
			}
		})
	}
}

// Local policy may contain a historical Unicode ID longer than the Gateway
// limit. Preserve local privacy and mark the snapshot incomplete instead of
// emitting a wire-invalid ID that causes the entire heartbeat to be rejected.
func TestInvalidMultibytePrivatePrinterIDCannotPoisonHeartbeat(t *testing.T) {
	ag, local := prepareSharingTestAgent(t, &fakePrinter{})
	if err := config.SetPrinterSharing(ag.configPath, local, nil, false); err != nil {
		t.Fatal(err)
	}
	excess := local
	excess.ID = strings.Repeat("ط", 61)
	ag.printerConfigs[excess.ID] = excess
	ids, complete := ag.privatePrinterIDs(ag.loadLocalPrinterSharing())
	if complete {
		t.Fatal("invalid UTF-8 byte-length private ID marked a complete heartbeat")
	}
	for _, id := range ids {
		if id == excess.ID || !validGatewaySharingID(id) {
			t.Fatalf("wire-invalid private printer ID included in heartbeat: %q", id)
		}
	}
}
