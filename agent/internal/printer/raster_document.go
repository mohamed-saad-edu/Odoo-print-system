package printer

import "strings"

func rasterGeometryReady(g *Geometry) bool {
	return g.Validate() == nil && g.RasterCommand == "gs_v_0"
}

// All byte transports share this preparation gate. It runs before a socket,
// USB handle or physical submission is opened, and never emits a partial image.
func prepareESCPOSImage(protocol string, g *Geometry, doc Document) ([]byte, error) {
	if !strings.EqualFold(strings.TrimSpace(protocol), "escpos") {
		return nil, CapabilityMismatchf("image raster output requires explicit ESC/POS transport")
	}
	if err := g.CheckImageFingerprint(doc.GeometryFingerprint); err != nil {
		return nil, err
	}
	if g.RasterCommand != "gs_v_0" {
		return nil, CapabilityMismatchf("printer profile must explicitly declare raster_command gs_v_0")
	}
	cfg, err := decodeJPEGConfig(doc.Data)
	if err != nil {
		return nil, err
	}
	if cfg.Width > g.PrintableWidthDots {
		return nil, CapabilityMismatchf("image width %d exceeds measured printable width %d; render again with current geometry", cfg.Width, g.PrintableWidthDots)
	}
	return JPEGToESCPOSWithMaxWidth(doc.Data, DefaultRasterSliceHeight, g.PrintableWidthDots)
}
