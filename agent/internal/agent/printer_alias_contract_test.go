package agent

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestGatewayPrinterAliasesAreBoundedAndResolveOnlyToTheirProvenAgentAndLocalID(t *testing.T) {
	for _, localID := range []string{strings.Repeat("x", 120), strings.Repeat("é", 60), "short-local"} {
		ag := newTestAgent(t, localID, &fakePrinter{})
		alias := gatewayAliasPrinterID(localID, ag.cfg.Agent.ID)
		if len(alias) > 120 || !utf8.ValidString(alias) {
			t.Fatalf("invalid bounded UTF-8 cloud printer ID %q: %d bytes", alias, len(alias))
		}
		if got := ag.resolvePrinterAlias(alias); got != localID {
			t.Fatalf("bounded alias lost exact local backend: expected %q got %q", localID, got)
		}
		foreign := gatewayAliasPrinterID(localID, "unrelated-agent")
		if got := ag.resolvePrinterAlias(foreign); got != foreign {
			t.Fatalf("foreign-agent alias resolved to a printer: %q", got)
		}
		forged := alias[:len(alias)-8] + "deadbeef"
		if forged == alias {
			forged = alias[:len(alias)-8] + "feedface"
		}
		if got := ag.resolvePrinterAlias(forged); got != forged {
			t.Fatalf("forged digest chose a printer: %q", got)
		}
	}
}

func TestPrinterAliasPrefixCannotChooseDifferentPrinter(t *testing.T) {
	ag := newTestAgent(t, "native-a", &fakePrinter{})
	ag.printers["native-b"] = &fakePrinter{}
	alias := gatewayAliasPrinterID("native-b", ag.cfg.Agent.ID)
	if got := ag.resolvePrinterAlias(alias); got != "native-b" {
		t.Fatalf("alias chose a different backend: %q", got)
	}
	forged := "native-a~" + strings.Split(alias, "~")[1]
	if got := ag.resolvePrinterAlias(forged); got != forged {
		t.Fatalf("alias reused another printer's digest: %q", got)
	}
}
