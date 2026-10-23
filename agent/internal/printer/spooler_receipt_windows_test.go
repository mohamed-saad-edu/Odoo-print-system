//go:build windows

package printer

import (
	"context"
	"testing"
	"time"
)

func TestWindowsReceiptProvenancePreservesPDFCallbacksAndContext(t *testing.T) {
	previous := platformPrintPDFObserved
	t.Cleanup(func() { platformPrintPDFObserved = previous })
	for _, seam := range []string{"plain", "result", "observed"} {
		t.Run(seam, func(t *testing.T) {
			p := NewSpooler("Receipt provenance test", "")
			p.ReceiptPaperMM, p.ReceiptRasterDots, p.ReceiptDPI = 80, 576, 203
			parent, cancel := context.WithTimeout(context.Background(), 7*time.Second)
			defer cancel()
			deadline, _ := parent.Deadline()
			admissions, calls := 0, 0
			ctx := WithDispatchAdmission(parent, func(context.Context) error { admissions++; return nil })
			ctx, evidence := WithSpoolerJobEvidence(ctx)
			wantReceipt := false
			check := func(callCtx context.Context, name, path string) error {
				calls++
				receipt, _ := callCtx.Value(generatedReceiptPDFKey{}).(bool)
				gotDeadline, ok := callCtx.Deadline()
				if receipt != wantReceipt || !ok || !gotDeadline.Equal(deadline) || callCtx.Value(spoolerEvidenceKey{}) != evidence || name != p.SpoolerName || path == "" {
					t.Errorf("PDF callback lost provenance/context: receipt=%t want=%t deadline=%v evidence=%v", receipt, wantReceipt, gotDeadline, callCtx.Value(spoolerEvidenceKey{}))
				}
				return runDispatchAdmission(callCtx)
			}
			switch seam {
			case "plain":
				p.PDFPrint = check
			case "result":
				p.PDFPrintResult = func(ctx context.Context, name, path string) (string, error) { return "123", check(ctx, name, path) }
			case "observed":
				platformPrintPDFObserved = func(ctx context.Context, name, path string, onID func(uint32)) (string, error) {
					onID(123)
					return "123", check(ctx, name, path)
				}
			}
			for _, doc := range []Document{
				{Kind: KindImage, Data: testReceiptJPEG(t, 576, 900), JobID: "image"},
				{Kind: KindPDF, Data: validPDF(), JobID: "ordinary-pdf-on-receipt-queue"},
			} {
				wantReceipt = doc.Kind == KindImage
				if err := p.PrintDocument(ctx, doc); err != nil {
					t.Fatal(err)
				}
			}
			if calls != 2 || admissions != 3 {
				t.Fatalf("conversion or callback duplicated: calls=%d admissions=%d", calls, admissions)
			}
			if err := p.PrintDocument(ctx, Document{Kind: KindImage, Data: []byte("invalid JPEG")}); err == nil || calls != 2 {
				t.Fatal("invalid image entered PDF execution")
			}
		})
	}
}
