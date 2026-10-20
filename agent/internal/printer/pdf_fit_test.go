package printer

import (
	"bytes"
	"encoding/binary"
	"errors"
	"math"
	"testing"
)

func TestPDFCurrentMediaPreservesFormPrivateBytesAndOrientation(t *testing.T) {
	buf := bytes.Repeat([]byte{0x4d}, 236)
	binary.LittleEndian.PutUint16(buf[68:70], 220)
	binary.LittleEndian.PutUint16(buf[70:72], 16)
	before := append([]byte(nil), buf...)
	if err := configurePDFCurrentMedia(buf); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(buf[:72], before[:72]) || !bytes.Equal(buf[76:84], before[76:84]) || !bytes.Equal(buf[88:], before[88:]) {
		t.Fatal("current-media normalization changed driver form, orientation or private fields")
	}
	if binary.LittleEndian.Uint16(buf[84:86]) != 100 || binary.LittleEndian.Uint16(buf[86:88]) != 1 {
		t.Fatal("current media retained driver scaling or duplicate copies")
	}
	if err := validatePDFDevModeResult(buf); err != nil {
		t.Fatal(err)
	}
	if err := configurePDFCurrentMedia(buf[:90]); err == nil {
		t.Fatal("truncated current media accepted")
	}
}

func TestPDFPaperModeFallbackIsBeforeSubmissionAndRetainsErrors(t *testing.T) {
	requestedErr, currentErr := errors.New("document form unsupported"), errors.New("driver unavailable")
	for _, tc := range []struct {
		name               string
		requested, current error
		wantFallback       bool
	}{
		{"document form", nil, nil, false}, {"current form", requestedErr, nil, true}, {"both fail", requestedErr, currentErr, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			mode, fallback, err := selectPDFPaperMode(func() ([]byte, error) { calls++; return []byte("requested"), tc.requested }, func() ([]byte, error) { calls++; return []byte("current"), tc.current })
			if fallback != tc.wantFallback {
				t.Fatalf("fallback=%v err=%v", fallback, err)
			}
			if tc.requested == nil && (calls != 1 || string(mode) != "requested" || err != nil) {
				t.Fatalf("supported form unnecessarily fell back: %d %q %v", calls, mode, err)
			}
			if tc.wantFallback && (calls != 2 || string(mode) != "current" || err != nil) {
				t.Fatalf("current driver media unavailable: %d %q %v", calls, mode, err)
			}
			if tc.current != nil && (!errors.Is(err, requestedErr) || !errors.Is(err, currentErr) || mode != nil) {
				t.Fatalf("driver failures were hidden: %v", err)
			}
		})
	}
}

func TestPDFFitKeepsWholePageProportionalInsidePrintableBounds(t *testing.T) {
	for _, tc := range []struct {
		name                                                                       string
		pointsW, pointsH                                                           float64
		physicalW, physicalH, printableW, printableH, dpiX, dpiY, offsetX, offsetY int
	}{
		{"Letter to POS80 driver72mm", 612, 792, 576, 800, 552, 776, 203, 203, 12, 12},
		{"80mm receipt on58mm driver", 80 * 72 / 25.4, 180 * 72 / 25.4, 464, 800, 440, 776, 203, 203, 12, 12},
		{"Letter to A4", 612, 792, 2480, 3508, 2330, 3328, 300, 300, 75, 90},
		{"landscape to portrait", 792, 612, 2550, 3300, 2400, 3120, 300, 300, 75, 90},
		{"unequal axis DPI", 612, 792, 5100, 3300, 4800, 3120, 600, 300, 150, 90},
		{"80mm roll70mm form", 80 * 72 / 25.4, 450 * 72 / 25.4, 560, 4000, 552, 3976, 203, 203, 4, 12},
		{"80mm roll70mm printable", 80 * 72 / 25.4, 450 * 72 / 25.4, 640, 4000, 560, 3976, 203, 203, 40, 12},
		{"custom narrow form300dpi", 75 * 72 / 25.4, 600 * 72 / 25.4, 886, 7500, 832, 7460, 300, 300, 27, 20},
		{"small page remains small", 144, 216, 2550, 3300, 2400, 3120, 300, 300, 75, 90},
		{"long page exceeds Windows form limit", 80 * 72 / 25.4, 4000 * 72 / 25.4, 640, 4000, 560, 3976, 203, 203, 40, 12},
		{"large page exceeds Windows form limit", 12000, 10000, 2550, 3300, 2400, 3120, 300, 300, 75, 90},
		{"page smaller than Windows form resolution", 0.01, 0.02, 2550, 3300, 2400, 3120, 300, 300, 75, 90},
	} {
		t.Run(tc.name, func(t *testing.T) {
			x, y, w, h, err := pdfPrintableDestination(tc.pointsW, tc.pointsH, tc.physicalW, tc.physicalH, tc.printableW, tc.printableH, tc.dpiX, tc.dpiY, tc.offsetX, tc.offsetY)
			if err != nil || x < 0 || y < 0 || w < 1 || h < 1 || x+w > tc.printableW || y+h > tc.printableH {
				t.Fatalf("content escaped printable paper: %d,%d %dx%d %v", x, y, w, h, err)
			}
			wantW, wantH := tc.pointsW*float64(tc.dpiX)/72, tc.pointsH*float64(tc.dpiY)/72
			if float64(w) > wantW+1 || float64(h) > wantH+1 {
				t.Fatal("small document enlarged")
			}
			scaleW, scaleH := float64(w)/wantW, float64(h)/wantH
			if math.Abs(scaleW-scaleH) > 1/wantW+1/wantH {
				t.Fatalf("physical aspect ratio changed: %g %g", scaleW, scaleH)
			}
			if x != (tc.printableW-w)/2 || y != (tc.printableH-h)/2 {
				t.Fatal("remaining printable space not centered")
			}
			t.Logf("fixture source=%.4gx%.4gpt physical=%dx%d printable=%dx%d dpi=%dx%d offset=%d,%d destination=%d,%d %dx%d",
				tc.pointsW, tc.pointsH, tc.physicalW, tc.physicalH, tc.printableW, tc.printableH, tc.dpiX, tc.dpiY, tc.offsetX, tc.offsetY, x, y, w, h)
		})
	}
}

func TestPDFFitBoundsExtremeFiniteSourceWithoutOverflow(t *testing.T) {
	for _, points := range [][2]float64{
		{math.MaxFloat64, math.MaxFloat64},
		{math.MaxFloat64, math.MaxFloat64 / 2},
		{math.SmallestNonzeroFloat64, math.SmallestNonzeroFloat64},
	} {
		x, y, w, h, err := pdfPrintableDestination(points[0], points[1], 2550, 3300, 2400, 3120, 300, 300, 75, 90)
		if err != nil || x < 0 || y < 0 || w < 1 || h < 1 || x+w > 2400 || y+h > 3120 {
			t.Fatalf("finite page not safely bounded: %g x %g -> %d,%d %dx%d %v", points[0], points[1], x, y, w, h, err)
		}
		if points[0] == math.MaxFloat64 && (w != 2400 || h != int(2400*(points[1]/points[0]))) {
			t.Fatalf("overflow changed source proportions: %dx%d", w, h)
		}
	}
}

func TestPDFFitStillRejectsInvalidPrinterAndDocumentGeometry(t *testing.T) {
	for _, tc := range []struct{ pw, ph, hw, hh, dx, dy, ox, oy int }{
		{0, 800, 552, 776, 203, 203, 0, 0}, {576, 800, 0, 776, 203, 203, 12, 12}, {576, 800, 552, 776, 0, 203, 12, 12},
		{576, 800, 575, 776, 203, 203, 12, 12}, {576, 800, 552, 799, 203, 203, 12, 12}, {576, 800, 552, 776, 203, 203, -1, 12},
	} {
		if _, _, _, _, err := pdfPrintableDestination(612, 792, tc.pw, tc.ph, tc.hw, tc.hh, tc.dx, tc.dy, tc.ox, tc.oy); err == nil {
			t.Fatalf("invalid native geometry admitted: %+v", tc)
		}
	}
	for _, value := range []float64{0, -1, math.NaN(), math.Inf(1), math.Inf(-1)} {
		for _, points := range [][2]float64{{value, 792}, {612, value}} {
			if _, _, _, _, err := pdfPrintableDestination(points[0], points[1], 576, 800, 552, 776, 203, 203, 12, 12); err == nil {
				t.Fatalf("malformed document dimensions accepted: %v", points)
			}
		}
	}
}
