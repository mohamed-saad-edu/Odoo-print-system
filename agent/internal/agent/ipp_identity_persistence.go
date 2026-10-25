package agent

import (
	"fmt"
	"maps"
	"reflect"

	"github.com/yaseir-agent/agent/internal/config"
	"github.com/yaseir-agent/agent/internal/printer"
)

// The persistence callback is attached before publication. It is invoked by
// IPP preflight outside the backend's status lock, including the very first
// print before any heartbeat has run.
func (a *Agent) attachPrinterIdentityPersistence(backend printer.Printer, pc config.PrinterConfig) {
	if setter, ok := backend.(interface{ SetIdentityPersistence(func(string) error) }); ok {
		// This callback belongs to one published backend generation. Runtime
		// capabilities may contain a verified UUID whose discovery disk write
		// failed, so only this callback's successful durable write can establish
		// the unmanaged fast path. Access is under desiredStatePersistMu.
		persistedUUID := ""
		setter.SetIdentityPersistence(func(uuid string) error {
			return a.persistPrinterIdentity(pc.ID, backend, pc, uuid, &persistedUUID)
		})
	}
}

func sameConfigWithoutObservedIPPUUID(left, right config.PrinterConfig) bool {
	left.Capabilities = maps.Clone(left.Capabilities)
	right.Capabilities = maps.Clone(right.Capabilities)
	delete(left.Capabilities, "ipp_printer_uuid")
	delete(right.Capabilities, "ipp_printer_uuid")
	if len(left.Capabilities) == 0 {
		left.Capabilities = nil
	}
	if len(right.Capabilities) == 0 {
		right.Capabilities = nil
	}
	return reflect.DeepEqual(left, right)
}

func sameIPPIdentityBinding(left, right config.PrinterConfig) bool {
	protocol := left.NormalizedProtocolOrUnknown()
	if (protocol != "ipp" && protocol != "ipps") || right.NormalizedProtocolOrUnknown() != protocol {
		return false
	}
	leftBinding, leftErr := config.PrinterBindingDigest(left)
	rightBinding, rightErr := config.PrinterBindingDigest(right)
	return leftErr == nil && rightErr == nil && leftBinding == rightBinding
}

// Callers hold desiredStateMu and printersMu. A completed old HTTP probe must
// never pin a newly published backend, even if the address happens to match.
func (a *Agent) identityGenerationCurrentLocked(id string, backend printer.Printer, expected config.PrinterConfig) bool {
	current, present := a.printerConfigs[id]
	if !present || a.printers[id] != backend || !sameConfigWithoutObservedIPPUUID(current, expected) {
		return false
	}
	if row, managed := a.desiredStates[id]; managed {
		return row.Desired.Lifecycle == "active" && a.matchesDesiredRuntime(current, row)
	}
	return true
}

func (a *Agent) persistPrinterIdentity(id string, backend printer.Printer, expected config.PrinterConfig, uuid string, persistedUUID *string) error {
	uuid = printer.VerifiedIPPUUIDFromCapabilities(map[string]interface{}{"ipp_printer_uuid": uuid})
	if uuid == "" {
		return fmt.Errorf("invalid verified printer identity")
	}
	// Serialize the first durable write and its in-memory publication. An
	// idempotent later observation can return immediately only after that
	// successful publication, never after a failed disk write.
	a.desiredStatePersistMu.Lock()
	defer a.desiredStatePersistMu.Unlock()
	a.desiredStateMu.Lock()
	a.printersMu.Lock()
	if !a.identityGenerationCurrentLocked(id, backend, expected) {
		a.printersMu.Unlock()
		a.desiredStateMu.Unlock()
		return fmt.Errorf("printer configuration changed during IPP identity observation")
	}
	current := a.printerConfigs[id]
	known := printer.VerifiedIPPUUIDFromCapabilities(current.Capabilities)
	row, managed := a.desiredStates[id]
	if known != "" && known != uuid {
		a.printersMu.Unlock()
		a.desiredStateMu.Unlock()
		return fmt.Errorf("verified IPP identity conflicts with established printer registration")
	}
	if known == uuid && ((managed && row.ObservedIPPUUID == uuid) || (!managed && *persistedUUID == uuid)) {
		a.printersMu.Unlock()
		a.desiredStateMu.Unlock()
		return nil
	}
	previousUUID := row.ObservedIPPUUID
	if managed {
		if previousUUID != "" && previousUUID != uuid {
			a.printersMu.Unlock()
			a.desiredStateMu.Unlock()
			return fmt.Errorf("verified IPP identity conflicts with persisted desired state")
		}
		row.ObservedIPPUUID = uuid
		a.desiredStates[id] = row
	}
	a.printersMu.Unlock()
	a.desiredStateMu.Unlock()

	var err error
	if managed {
		err = a.persistDesiredStateLocked()
	} else {
		err = printer.PersistVerifiedIPPIdentity(a.registryPath, current, uuid)
	}
	if err != nil {
		if managed {
			a.desiredStateMu.Lock()
			if latest, exists := a.desiredStates[id]; exists && latest.ObservedIPPUUID == uuid && reflect.DeepEqual(latest.Desired, row.Desired) {
				latest.ObservedIPPUUID = previousUUID
				a.desiredStates[id] = latest
			}
			a.desiredStateMu.Unlock()
		}
		return err
	}

	a.desiredStateMu.Lock()
	defer a.desiredStateMu.Unlock()
	a.printersMu.Lock()
	defer a.printersMu.Unlock()
	if !a.identityGenerationCurrentLocked(id, backend, expected) {
		return fmt.Errorf("printer configuration changed while persisting IPP identity")
	}
	current = a.printerConfigs[id]
	current.Capabilities = maps.Clone(current.Capabilities)
	if current.Capabilities == nil {
		current.Capabilities = make(map[string]interface{})
	}
	current.Capabilities["ipp_printer_uuid"] = uuid
	a.printerConfigs[id] = current
	*persistedUUID = uuid
	return nil
}
