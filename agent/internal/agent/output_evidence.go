package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/yaseir-agent/agent/internal/printer"
	"github.com/yaseir-agent/agent/internal/queue"
)

func encodeOutputEvidence(value *printer.OutputEvidence) (string, error) {
	if value == nil {
		return "", nil
	}
	if err := printer.ValidateOutputEvidence(value); err != nil {
		return "", err
	}
	encoded, err := json.Marshal(value)
	return string(encoded), err
}

func decodeOutputEvidence(value string) (*printer.OutputEvidence, error) {
	if value == "" {
		return nil, nil
	}
	if len(value) > 1024 {
		return nil, fmt.Errorf("durable output evidence exceeds its bound")
	}
	decoder := json.NewDecoder(strings.NewReader(value))
	decoder.DisallowUnknownFields()
	var evidence printer.OutputEvidence
	if err := decoder.Decode(&evidence); err != nil {
		return nil, fmt.Errorf("invalid durable output evidence: %w", err)
	}
	var extra interface{}
	if err := decoder.Decode(&extra); err != io.EOF {
		return nil, fmt.Errorf("durable output evidence contains trailing data")
	}
	if err := printer.ValidateOutputEvidence(&evidence); err != nil {
		return nil, err
	}
	return &evidence, nil
}

func (a *Agent) reportDurableTerminalResult(ctx context.Context, report queue.TerminalReport) error {
	if report.ClaimToken == "" {
		return fmt.Errorf("terminal result has no retained execution claim; explicit reconciliation is required")
	}
	evidence, err := decodeOutputEvidence(report.OutputEvidence)
	if err != nil {
		return err
	}
	return a.updateJobStatusWithOutputEvidence(ctx, report.ID, report.Status, report.LastError, report.ClaimToken,
		report.SpoolerJobID, report.Transport, evidence)
}

func cloneOutputEvidence(value *printer.OutputEvidence) *printer.OutputEvidence {
	if value == nil {
		return nil
	}
	copy := *value
	return &copy
}
