package printer

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/yaseir-agent/agent/internal/config"
	"gopkg.in/yaml.v3"
)

func approvedPDFOutputConfig(t *testing.T, dir string) config.PrinterConfig {
	t.Helper()
	raw, err := yaml.Marshal(map[string]interface{}{"pdf_output_profiles": map[string]interface{}{"approved": map[string]interface{}{"directory": dir}}, "printers": []map[string]interface{}{{"id": "export", "name": "Approved PDF output", "type": "pdf_output", "protocol": "pdf", "printer_type": "file", "output_profile_id": "approved", "endpoint": "pdf-output:approved"}}})
	if err != nil {
		t.Fatal(err)
	}
	var cfg config.Config
	if err := yaml.Unmarshal(raw, &cfg); err != nil {
		t.Fatal(err)
	}
	if resolver, ok := interface{}(&cfg).(interface {
		ResolvePDFOutput(config.PrinterConfig) (config.PrinterConfig, error)
	}); ok {
		pc, err := resolver.ResolvePDFOutput(cfg.Printers[0])
		if err != nil {
			t.Fatal(err)
		}
		return pc
	}
	return cfg.Printers[0]
}

func TestPDFOutputCreatesActualReadableFileWithoutPhysicalSubmission(t *testing.T) {
	dir := t.TempDir()
	pc := approvedPDFOutputConfig(t, dir)
	p, err := New(pc)
	if err != nil {
		t.Fatalf("approved PDF output has no executable backend: %v", err)
	}
	if !SupportsKind(p, KindPDF) || SupportsKind(p, KindRaw) || SupportsKind(p, KindESCPOS) {
		t.Fatal("PDF file backend advertised a byte printer language")
	}
	ctx, output := WithOutputEvidence(context.Background())
	data := validPDF()
	if err := PrintDocument(ctx, p, Document{Kind: KindPDF, Data: data, JobID: "../../untrusted-name"}); err != nil {
		t.Fatal(err)
	}
	files, err := os.ReadDir(dir)
	if err != nil || len(files) != 1 {
		t.Fatalf("real output count=%d error=%v", len(files), err)
	}
	if files[0].Name() == "untrusted-name.pdf" || files[0].Name() == "../../untrusted-name" {
		t.Fatal("job metadata selected the local output filename")
	}
	evidence := output.Close()
	if err := ValidateOutputEvidence(evidence); err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(filepath.Join(dir, files[0].Name()))
	if err != nil || !bytes.Equal(actual, data) {
		t.Fatalf("PDF output was not byte-identical: %v", err)
	}
	hash := sha256.Sum256(actual)
	if evidence.ArtifactID+".pdf" != files[0].Name() || evidence.SHA256 != hex.EncodeToString(hash[:]) || evidence.Bytes != int64(len(actual)) || evidence.PageCount != 1 {
		t.Fatalf("file evidence does not describe actual file: %+v", evidence)
	}
}

func standardPDFOutputGeometry(widthMM, heightMM float64, dpiX, dpiY int) *config.GeometryProfile {
	x, y := int(math.Round(5*float64(dpiX)/25.4)), int(math.Round(5*float64(dpiY)/25.4))
	w, h := int(math.Floor((widthMM-10)*float64(dpiX)/25.4)), int(math.Floor((heightMM-10)*float64(dpiY)/25.4))
	return &config.GeometryProfile{PrintableWidthDots: w, PrintableHeightDots: &h,
		DPIX: &dpiX, DPIY: &dpiY, PaperWidthMM: &widthMM, PaperHeightMM: &heightMM, OffsetXDots: &x, OffsetYDots: &y}
}

func TestPDFOutputImageUsesExplicitPageGeometryAndPagination(t *testing.T) {
	for _, tc := range []struct {
		name              string
		widthMM, heightMM float64
		dpiX, dpiY        int
	}{{"A4", 210, 297, 203, 203}, {"A5", 148, 210, 300, 300}, {"Letter", 215.9, 279.4, 600, 600}, {"LegalMixedDPI", 215.9, 355.6, 203, 300}} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			pc := approvedPDFOutputConfig(t, dir)
			pc.GeometryProfile = standardPDFOutputGeometry(tc.widthMM, tc.heightMM, tc.dpiX, tc.dpiY)
			p, err := New(pc)
			if err != nil {
				t.Fatal(err)
			}
			geometry, err := CurrentGeometry(context.Background(), p, pc)
			if err != nil {
				t.Fatal(err)
			}
			if !SupportsKind(p, KindImage) {
				t.Fatal("approved measured file backend cannot execute POS images")
			}
			data := pageReceiptJPEG(t, min(512, geometry.PrintableWidthDots), *geometry.PrintableHeightDots+137)
			ctx, output := WithOutputEvidence(context.Background())
			if err := PrintDocument(ctx, p, Document{Kind: KindImage, Data: data, GeometryFingerprint: geometry.ConfigFingerprint}); err != nil {
				t.Fatal(err)
			}
			evidence := output.Close()
			if evidence == nil || evidence.PageCount != 2 {
				t.Fatalf("long receipt should produce two standard pages: %+v", evidence)
			}
			pdf, err := os.ReadFile(filepath.Join(dir, evidence.ArtifactID+".pdf"))
			if err != nil {
				t.Fatal(err)
			}
			pages, err := inspectIPPPDFPages(context.Background(), pdf)
			if err != nil || len(pages) != 2 {
				t.Fatalf("actual PDF pages: %+v %v", pages, err)
			}
			for _, page := range pages {
				if math.Abs(page.WidthPoints*25.4/72-tc.widthMM) > 0.001 || math.Abs(page.HeightPoints*25.4/72-tc.heightMM) > 0.001 {
					t.Fatalf("standard paper was changed: %+v", page)
				}
			}
			if bytes.Count(pdf, data) != 1 {
				t.Fatal("pagination re-encoded or duplicated the receipt JPEG")
			}
		})
	}
}

func TestPDFOutputCapabilityMatchesActualFileBackend(t *testing.T) {
	d := TransportFacts{Connection: "pdf_output", Protocol: "pdf"}
	if ok, reason := PayloadCompatibleForDevice("pdf", "", d); !ok {
		t.Fatalf("approved file transport rejected PDF: %s", reason)
	}
	if ok, _ := PayloadCompatibleForDevice("image", "", d); ok {
		t.Fatal("file image accepted missing physical page geometry")
	}
	pc := approvedPDFOutputConfig(t, t.TempDir())
	pc.GeometryProfile = standardPDFOutputGeometry(210, 297, 300, 300)
	d.Geometry, _ = ConfiguredGeometry(pc)
	if ok, reason := PayloadCompatibleForDevice("image", "", d); !ok {
		t.Fatalf("file image rejected full physical geometry: %s", reason)
	}
	for _, kind := range []string{KindRaw, KindESCPOS} {
		if ok, _ := PayloadCompatibleForDevice(kind, "escpos", d); ok {
			t.Fatalf("file backend accepted %s byte language", kind)
		}
	}
}

func TestPDFOutputOperationalVerificationCreatesReadsAndRemovesProbe(t *testing.T) {
	dir := t.TempDir()
	pc := approvedPDFOutputConfig(t, dir)
	p, err := New(pc)
	if err != nil {
		t.Fatal(err)
	}
	// This test covers the actual file probe after renderer readiness. The
	// fresh-process cancellation/recovery test separately proves cold behavior.
	startup, cancel := context.WithTimeout(context.Background(), 110*time.Second)
	defer cancel()
	if err := awaitPDFiumWarmup(startup); err != nil {
		t.Fatal(err)
	}
	proof, err := ProbeOperationalVerification(context.Background(), p, pc)
	if err != nil {
		t.Fatal(err)
	}
	if proof.OutputMedium != "file" || proof.Method != "pdf_output" {
		t.Fatalf("file probe claimed physical output: %+v", proof)
	}
	files, err := os.ReadDir(dir)
	if err != nil || len(files) != 0 {
		t.Fatalf("verification left a customer document: %v %v", files, err)
	}
}

func TestPDFOutputRejectsMalformedCanceledAndSymlinkDestinationsBeforePublication(t *testing.T) {
	t.Run("malformed", func(t *testing.T) {
		dir := t.TempDir()
		p, err := New(approvedPDFOutputConfig(t, dir))
		if err != nil {
			t.Fatal(err)
		}
		ctx, out := WithOutputEvidence(context.Background())
		err = PrintDocument(ctx, p, Document{Kind: KindPDF, Data: []byte("%PDF-1.4\ninvalid\n%%EOF\n")})
		files, _ := os.ReadDir(dir)
		if err == nil || len(files) != 0 || out.Close() != nil {
			t.Fatalf("malformed PDF created output: %v %v", files, err)
		}
	})
	t.Run("canceled", func(t *testing.T) {
		dir := t.TempDir()
		p, err := New(approvedPDFOutputConfig(t, dir))
		if err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		ctx, out := WithOutputEvidence(ctx)
		err = PrintDocument(ctx, p, Document{Kind: KindPDF, Data: validPDF()})
		files, _ := os.ReadDir(dir)
		if err == nil || len(files) != 0 || out.Close() != nil {
			t.Fatalf("canceled invocation created output: %v %v", files, err)
		}
	})
	t.Run("symlink", func(t *testing.T) {
		base := t.TempDir()
		outside := t.TempDir()
		link := filepath.Join(base, "link")
		if err := os.Symlink(outside, link); err != nil {
			t.Skipf("host cannot create link for this case: %v", err)
		}
		p, err := New(approvedPDFOutputConfig(t, link))
		if err != nil {
			t.Fatal(err)
		}
		err = PrintDocument(context.Background(), p, Document{Kind: KindPDF, Data: validPDF()})
		files, _ := os.ReadDir(outside)
		if err == nil || len(files) != 0 {
			t.Fatalf("linked destination accepted: %v %v", files, err)
		}
		if strings.Contains(err.Error(), outside) || strings.Contains(err.Error(), link) {
			t.Fatal("local path escaped into public error")
		}
	})
}

func TestPDFOutputConcurrentJobsNeverOverwriteOrShareEvidence(t *testing.T) {
	dir := t.TempDir()
	pc := approvedPDFOutputConfig(t, dir)
	p, err := New(pc)
	if err != nil {
		t.Fatal(err)
	}
	prior := filepath.Join(dir, "existing.pdf")
	original := []byte("existing user content")
	if err := os.WriteFile(prior, original, 0600); err != nil {
		t.Fatal(err)
	}
	const jobs = 3
	var wg sync.WaitGroup
	values := make(chan *OutputEvidence, jobs)
	errs := make(chan error, jobs)
	for i := 0; i < jobs; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ctx, scope := WithOutputEvidence(context.Background())
			errs <- PrintDocument(ctx, p, Document{Kind: KindPDF, Data: validPDF(), JobID: "same-id"})
			values <- scope.Close()
		}()
	}
	wg.Wait()
	close(errs)
	close(values)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	ids := map[string]bool{}
	for v := range values {
		if v == nil || ids[v.ArtifactID] {
			t.Fatalf("duplicate or absent invocation result: %+v", v)
		}
		ids[v.ArtifactID] = true
	}
	files, err := os.ReadDir(dir)
	if err != nil || len(files) != jobs+1 {
		t.Fatalf("output count %d error %v", len(files), err)
	}
	retained, err := os.ReadFile(prior)
	if err != nil || !bytes.Equal(retained, original) {
		t.Fatal("existing file was overwritten")
	}
}

func TestPDFOutputLateEvidenceIsUnknownAndCreatedFileIsRetained(t *testing.T) {
	dir := t.TempDir()
	p, err := New(approvedPDFOutputConfig(t, dir))
	if err != nil {
		t.Fatal(err)
	}
	ctx, scope := WithOutputEvidence(context.Background())
	scope.Close()
	err = PrintDocument(ctx, p, Document{Kind: KindPDF, Data: validPDF()})
	if !OutcomeUnknown(err) {
		t.Fatalf("late file completion was not UNKNOWN: %v", err)
	}
	files, _ := os.ReadDir(dir)
	if len(files) != 1 || scope.Snapshot() != nil {
		t.Fatalf("late output was deleted or evidence reused: %v %+v", files, scope.Snapshot())
	}
}

func mixedStandardPDF() ([]byte, [][2]float64) {
	sizes := [][2]float64{{210, 297}, {148, 210}, {215.9, 279.4}, {215.9, 355.6}, {297, 210}, {279.4, 215.9}}
	var output, kids bytes.Buffer
	output.WriteString("%PDF-1.4\n")
	offsets := make([]int, 3+len(sizes)*2)
	object := func(id int, body string) {
		offsets[id] = output.Len()
		fmt.Fprintf(&output, "%d 0 obj\n%s\nendobj\n", id, body)
	}
	object(1, "<< /Type /Catalog /Pages 2 0 R >>")
	for i := range sizes {
		fmt.Fprintf(&kids, "%d 0 R ", 3+2*i)
	}
	object(2, fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", kids.String(), len(sizes)))
	for i, size := range sizes {
		width, height := size[0]*72/25.4, size[1]*72/25.4
		object(3+2*i, fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %.9f %.9f] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents %d 0 R >>", width, height, 4+2*i))
		content := fmt.Sprintf("BT /F1 12 Tf 24 %.9f Td (Standard media page %d) Tj ET\n", height-36, i+1)
		object(4+2*i, fmt.Sprintf("<< /Length %d >>\nstream\n%sendstream", len(content), content))
	}
	xref := output.Len()
	fmt.Fprintf(&output, "xref\n0 %d\n0000000000 65535 f\n", len(offsets))
	for _, offset := range offsets[1:] {
		fmt.Fprintf(&output, "%010d 00000 n\n", offset)
	}
	fmt.Fprintf(&output, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(offsets), xref)
	return output.Bytes(), sizes
}

func TestPDFOutputAcceptsMixedStandardPageSizesAndOrientationsByteForByte(t *testing.T) {
	dir := t.TempDir()
	p, err := New(approvedPDFOutputConfig(t, dir))
	if err != nil {
		t.Fatal(err)
	}
	data, sizes := mixedStandardPDF()
	ctx, scope := WithOutputEvidence(context.Background())
	if err := PrintDocument(ctx, p, Document{Kind: KindPDF, Data: data}); err != nil {
		t.Fatal(err)
	}
	evidence := scope.Close()
	if evidence == nil || evidence.PageCount != len(sizes) {
		t.Fatalf("mixed document evidence: %+v", evidence)
	}
	actual, err := os.ReadFile(filepath.Join(dir, evidence.ArtifactID+".pdf"))
	if err != nil || !bytes.Equal(data, actual) {
		t.Fatal("mixed-media document was transformed")
	}
	pages, err := inspectIPPPDFPages(context.Background(), actual)
	if err != nil || len(pages) != len(sizes) {
		t.Fatalf("actual mixed PDF page count: %+v %v", pages, err)
	}
	for i, page := range pages {
		if math.Abs(page.WidthPoints*25.4/72-sizes[i][0]) > 0.001 || math.Abs(page.HeightPoints*25.4/72-sizes[i][1]) > 0.001 {
			t.Fatalf("mixed page %d media/orientation changed: %+v", i, page)
		}
	}
}

func TestPDFOutputInvalidImageGeometryOrBodyCreatesNoFile(t *testing.T) {
	data, source := pageBreakFixture(t)
	for _, scenario := range []string{"missing-height", "missing-offset", "stale-fingerprint", "too-wide", "truncated-body"} {
		t.Run(scenario, func(t *testing.T) {
			dir := t.TempDir()
			pc := approvedPDFOutputConfig(t, dir)
			profile := source.GeometryProfile
			pc.GeometryProfile = &profile
			if scenario == "missing-height" {
				profile.PaperHeightMM = nil
			}
			if scenario == "missing-offset" {
				profile.OffsetYDots = nil
			}
			p, err := New(pc)
			if err != nil {
				t.Fatal(err)
			}
			g, _ := ConfiguredGeometry(pc)
			fingerprint := g.ConfigFingerprint
			imageData := data
			if scenario == "stale-fingerprint" {
				fingerprint = strings.Repeat("0", 64)
			}
			if scenario == "too-wide" {
				imageData = pageReceiptJPEG(t, 577, 150)
			}
			if scenario == "truncated-body" {
				imageData = data[:len(data)-100]
			}
			ctx, scope := WithOutputEvidence(context.Background())
			err = PrintDocument(ctx, p, Document{Kind: KindImage, Data: imageData, GeometryFingerprint: fingerprint})
			files, _ := os.ReadDir(dir)
			if err == nil || len(files) != 0 || scope.Close() != nil {
				t.Fatalf("invalid image created output: %v %v", files, err)
			}
		})
	}
}

func TestPDFOutputHonorsFinalAdmissionAndProbeCannotRecurse(t *testing.T) {
	t.Run("revoked-before-publication", func(t *testing.T) {
		dir := t.TempDir()
		pc := approvedPDFOutputConfig(t, dir)
		backend, err := New(pc)
		if err != nil {
			t.Fatal(err)
		}
		refused := errors.New("claim or local sharing was revoked during preparation")
		calls := 0
		ctx := WithDispatchAdmission(context.Background(), func(context.Context) error { calls++; return refused })
		ctx, scope := WithOutputEvidence(ctx)
		err = PrintDocument(ctx, backend, Document{Kind: KindPDF, Data: validPDF()})
		files, readErr := os.ReadDir(dir)
		if !errors.Is(err, refused) || calls != 1 || readErr != nil || len(files) != 0 || scope.Close() != nil {
			t.Fatalf("revoked output escaped final gate: err=%v calls=%d files=%v read=%v", err, calls, files, readErr)
		}
	})
	t.Run("live-verification-inside-final-admission", func(t *testing.T) {
		dir := t.TempDir()
		pc := approvedPDFOutputConfig(t, dir)
		backend, err := New(pc)
		if err != nil {
			t.Fatal(err)
		}
		calls := 0
		ctx := WithDispatchAdmission(context.Background(), func(ctx context.Context) error {
			calls++
			if calls != 1 {
				return errors.New("operational probe recursed through dispatch admission")
			}
			_, err := backend.(OperationalVerifier).VerifyOperational(ctx, pc)
			return err
		})
		ctx, scope := WithOutputEvidence(ctx)
		err = PrintDocument(ctx, backend, Document{Kind: KindPDF, Data: validPDF()})
		files, readErr := os.ReadDir(dir)
		if err != nil || calls != 1 || readErr != nil || len(files) != 1 || scope.Close() == nil {
			t.Fatalf("verified file output or probe separation failed: err=%v calls=%d files=%v read=%v", err, calls, files, readErr)
		}
	})
}
