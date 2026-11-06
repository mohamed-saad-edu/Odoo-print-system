package agent

import (
	"context"
	"errors"
	"fmt"
	"log"

	"github.com/yaseir-agent/agent/internal/queue"
)

// reportDurableTerminalResult re-reports a terminal result persisted in
// the local queue outbox (for example after a lost Gateway
// acknowledgement) WITHOUT re-running printer I/O. The retained claim
// token is the execution identity being reconciled.
func (a *Agent) reportDurableTerminalResult(ctx context.Context, report queue.TerminalReport) error {
	if report.ClaimToken == "" {
		return fmt.Errorf("terminal result has no retained execution claim; explicit reconciliation is required")
	}
	err := a.updateJobStatusWithTransport(ctx, report.ID, report.Status, report.LastError, report.ClaimToken,
		report.SpoolerJobID, report.Transport)
	if err != nil && errors.Is(err, ErrJobCanceled) {
		// v4: the Gateway has settled this job as canceled (operator
		// decision, or the 24h claimed-cancel reconciliation window
		// closed). No re-report can ever succeed, so keeping the entry
		// in the pending outbox would retry it forever across scan
		// cycles. Clearing the local claim token drops it from the
		// pending set WITHOUT re-running printer I/O; the local terminal
		// row (status + error) is retained for forensics.
		log.Printf("Job %s: gateway settled job as canceled; dropping terminal re-report (no reprint)", report.ID)
		if clearErr := a.queue.ClearClaimToken(report.ID, report.ClaimToken); clearErr != nil {
			log.Printf("Job %s: could not clear canceled terminal report token: %v", report.ID, clearErr)
			return err
		}
		return nil
	}
	return err
}
