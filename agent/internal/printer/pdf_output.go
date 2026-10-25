package printer

import (
	"bytes"
	"context"
	"fmt"

	"github.com/yaseir-agent/agent/internal/config"
)

type PDFOutputPrinter struct{ Config config.PrinterConfig }

func (p *PDFOutputPrinter) SupportsKind(kind string) bool {
	switch NormalizeKind(kind) {
	case KindPDF:
		return true
	case KindImage:
		geometry, err := ConfiguredGeometry(p.Config)
		return err == nil && geometry.PhysicalPageImageReady()
	default:
		return false
	}
}

func (p *PDFOutputPrinter) Print(ctx context.Context, data []byte) error {
	return p.PrintDocument(ctx, Document{Kind: KindPDF, Data: data})
}

func (p *PDFOutputPrinter) PrintDocument(ctx context.Context, doc Document) error {
	if !p.SupportsKind(doc.Kind) {
		return CapabilityMismatchf("PDF output accepts PDFs and images with full measured physical page geometry")
	}
	data := doc.Data
	if NormalizeKind(doc.Kind) == KindImage {
		geometry, err := p.PrinterGeometry(ctx)
		if err != nil {
			return err
		}
		if err := geometry.CheckImageFingerprint(doc.GeometryFingerprint); err != nil {
			return err
		}
		data, err = JPEGToPagedPDFGeometry(data, geometry)
		if err != nil {
			return err
		}
	} else if err := ValidatePDF(data); err != nil {
		return err
	}
	evidence, err := writeVerifiedPDF(ctx, p.Config, data, false)
	if err != nil {
		return err
	}
	if !recordOutputEvidence(ctx, *evidence) {
		return MarkUnknown("PDF file was created after its invocation evidence scope closed; reconcile the artifact before another job")
	}
	return nil
}

func (p *PDFOutputPrinter) Status() string {
	root, err := openPDFOutputRoot(p.Config)
	if err != nil {
		return "unknown"
	}
	root.Close()
	return "online"
}

func (p *PDFOutputPrinter) Test(ctx context.Context) error {
	_, err := p.VerifyOperational(ctx, p.Config)
	return err
}

func (p *PDFOutputPrinter) PrinterGeometry(ctx context.Context) (*Geometry, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return ConfiguredGeometry(p.Config)
}

func (p *PDFOutputPrinter) VerifyOperational(ctx context.Context, cfg config.PrinterConfig) (*OperationalVerification, error) {
	expected, err := config.PrinterBindingDigest(p.Config)
	if err != nil {
		return nil, err
	}
	current, err := config.PrinterBindingDigest(cfg)
	if err != nil || current != expected {
		return nil, fmt.Errorf("PDF output binding changed before verification")
	}
	root, err := openPDFOutputRoot(p.Config)
	if err != nil {
		return nil, err
	}
	root.Close()
	if err := awaitPDFiumWarmup(ctx); err != nil {
		return nil, err
	}
	if _, err := writeVerifiedPDF(ctx, p.Config, pdfOutputProbeDocument(), true); err != nil {
		return nil, err
	}
	return NewOperationalVerification(cfg, "pdf_output", "service", "", "file")
}

func pdfOutputProbeDocument() []byte {
	// Small blank PDF, with valid object offsets and a real page. The probe is
	// created/read/removed only inside the approved directory, never printed.
	var output bytes.Buffer
	output.WriteString("%PDF-1.4\n")
	objects := []string{"<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Resources << >> /Contents 4 0 R >>", "<< /Length 0 >>\nstream\n\nendstream"}
	offsets := make([]int, len(objects)+1)
	for i, object := range objects {
		offsets[i+1] = output.Len()
		fmt.Fprintf(&output, "%d 0 obj\n%s\nendobj\n", i+1, object)
	}
	xref := output.Len()
	fmt.Fprintf(&output, "xref\n0 %d\n0000000000 65535 f\n", len(offsets))
	for _, offset := range offsets[1:] {
		fmt.Fprintf(&output, "%010d 00000 n\n", offset)
	}
	fmt.Fprintf(&output, "trailer\n<< /Root 1 0 R /Size %d >>\nstartxref\n%d\n%%%%EOF\n", len(offsets), xref)
	return output.Bytes()
}
