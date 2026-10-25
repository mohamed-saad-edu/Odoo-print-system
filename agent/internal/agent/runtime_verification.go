package agent

import (
	"context"
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/yaseir-agent/agent/internal/config"
	"github.com/yaseir-agent/agent/internal/printer"
)

func (a *Agent) resolveLocalPrinter(pc config.PrinterConfig) (config.PrinterConfig, error) {
	if a.cfg == nil {
		if pc.NormalizedType() == "pdf_output" {
			return pc, fmt.Errorf("PDF output requires a local administrator profile")
		}
		return pc, nil
	}
	return a.cfg.ResolvePDFOutput(pc)
}

func (a *Agent) resolvedDesiredPrinterConfig(row desiredPrinterRecord) (config.PrinterConfig, error) {
	return a.resolveLocalPrinter(desiredPrinterConfig(row))
}

func (a *Agent) matchesDesiredRuntime(current config.PrinterConfig, row desiredPrinterRecord) bool {
	expected, err := a.resolvedDesiredPrinterConfig(row)
	return err == nil && sameConfigWithoutObservedIPPUUID(current, expected)
}

// Read-only generation fence after a potentially slow OS/protocol query.
// The lock order matches desired-state application and identity persistence.
func (a *Agent) printerObservationCurrent(id string, backend printer.Printer, expected config.PrinterConfig) bool {
	a.desiredStateMu.Lock()
	defer a.desiredStateMu.Unlock()
	a.printersMu.RLock()
	defer a.printersMu.RUnlock()
	return a.identityGenerationCurrentLocked(id, backend, expected)
}

func (a *Agent) verifyPrinterForDispatch(ctx context.Context, id string, backend printer.Printer, expected config.PrinterConfig, admittedBinding string) error {
	if !validAdmissionBinding(admittedBinding) {
		return fmt.Errorf("%w: job has no valid admission destination", printer.ErrPrinterUnverified)
	}
	proof, err := printer.ProbeOperationalVerification(ctx, backend, expected)
	if err != nil {
		return err
	}
	if proof.BindingDigest != admittedBinding {
		return fmt.Errorf("%w: current destination differs from the accepted job", printer.ErrPrinterUnverified)
	}
	if !a.printerObservationCurrent(id, backend, expected) {
		return fmt.Errorf("%w: printer configuration changed during verification", printer.ErrPrinterUnverified)
	}
	return nil
}

func validAdmissionBinding(value string) bool {
	if len(value) != 64 || value != strings.ToLower(value) {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}
