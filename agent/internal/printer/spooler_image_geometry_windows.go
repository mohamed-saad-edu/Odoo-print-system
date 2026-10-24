//go:build windows

package printer

import "math"

func checkImageDeviceGeometry(g *Geometry, physicalW, physicalH, printableW, printableH, dpiX, dpiY, offsetX, offsetY int) error {
	if !g.PhysicalImageReady() {
		return CapabilityMismatchf("measured physical image geometry is required")
	}
	actual, err := deviceGeometryProfile(physicalW, physicalH, printableW, printableH, dpiX, dpiY, offsetX, offsetY)
	if err != nil {
		return err
	}
	if g.PrintableWidthDots != actual.PrintableWidthDots || *g.DPIX != dpiX || *g.DPIY != dpiY ||
		math.Abs(*g.PaperWidthMM-*actual.PaperWidthMM) > 25.4/float64(dpiX)+1e-9 ||
		(g.PrintableHeightDots != nil && *g.PrintableHeightDots != printableH) ||
		(g.PaperHeightMM != nil && math.Abs(*g.PaperHeightMM-*actual.PaperHeightMM) > 25.4/float64(dpiY)+1e-9) ||
		(g.OffsetXDots != nil && *g.OffsetXDots != offsetX) || (g.OffsetYDots != nil && *g.OffsetYDots != offsetY) {
		return CapabilityMismatchf("Windows driver geometry changed after image rendering; refresh measurements and render again")
	}
	return nil
}

// imageGeometryKey carries the exact profile checked before image conversion.
// The actual DC is checked again before StartDocW.
type imageGeometryKey struct{}

type generatedReceiptJPEGKey struct{}
