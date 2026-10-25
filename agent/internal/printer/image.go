package printer

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"math"
)

const (
	DefaultRasterSliceHeight   = 256
	LowBufferRasterSliceHeight = 128
	MaxJPEGDimension           = 16384
	MaxJPEGPixels              = 40_000_000
	MaxRasterOutputBytes       = 32 * 1024 * 1024
)

// JPEGToESCPOSWithMaxWidth converts a JPEG raster while respecting the
// configured printer width. Unknown or excessive widths fail before allocation.
func JPEGToESCPOSWithMaxWidth(data []byte, sliceHeight, maxWidth int) ([]byte, error) {
	if maxWidth < 1 || maxWidth > MaxJPEGDimension {
		return nil, fmt.Errorf("raster width must be explicitly measured in dots (1..%d)", MaxJPEGDimension)
	}
	return jpegToESCPOS(data, sliceHeight, maxWidth)
}

func jpegToESCPOS(data []byte, sliceHeight, maxWidth int) ([]byte, error) {
	if sliceHeight <= 0 {
		sliceHeight = DefaultRasterSliceHeight
	}
	if sliceHeight > 65535 {
		return nil, fmt.Errorf("raster band height exceeds GS v 0 field limit")
	}
	if maxWidth < 1 || maxWidth > MaxJPEGDimension {
		return nil, fmt.Errorf("raster width must be explicitly measured in dots (1..%d)", MaxJPEGDimension)
	}
	cfg, err := decodeJPEGConfig(data)
	if err != nil {
		return nil, err
	}
	if cfg.Width <= 0 || cfg.Height <= 0 {
		return nil, fmt.Errorf("invalid JPEG dimensions %dx%d", cfg.Width, cfg.Height)
	}
	outputWidth, outputHeight := cfg.Width, cfg.Height
	if outputWidth > maxWidth {
		outputHeight = max(1, int(math.Round(float64(outputHeight)*float64(maxWidth)/float64(outputWidth))))
		outputWidth = maxWidth
	}
	rowBytes := (outputWidth + 7) / 8
	bands := (outputHeight + sliceHeight - 1) / sliceHeight
	rasterBytes := int64(rowBytes)*int64(outputHeight) + int64(bands*8) + 2
	if rasterBytes > MaxRasterOutputBytes {
		return nil, fmt.Errorf("ESC/POS raster output %d bytes exceeds %d limit", rasterBytes, MaxRasterOutputBytes)
	}

	img, err := jpeg.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("decode JPEG: %w", err)
	}

	// Never exceed the printer's declared raster width. This is deliberately
	// capability-driven rather than inferred from the input image dimensions.
	if img.Bounds().Dx() > maxWidth {
		img = resizeNearest(img, maxWidth)
	}

	w := img.Bounds().Dx()
	h := img.Bounds().Dy()
	rowBytes = (w + 7) / 8

	// Pre-convert or extract direct raster buffer for performance
	rgbaImg, isRGBA := img.(*image.RGBA)

	out := bytes.NewBuffer(make([]byte, 0, rowBytes*h+128))
	out.Write([]byte{0x1b, 0x40}) // ESC @ (initialize)

	// Emit vertical bands
	for yStart := 0; yStart < h; yStart += sliceHeight {
		bandHeight := sliceHeight
		if yStart+bandHeight > h {
			bandHeight = h - yStart
		}
		bandRaster := make([]byte, rowBytes*bandHeight)

		for by := 0; by < bandHeight; by++ {
			actualY := yStart + by
			bandOffset := by * rowBytes

			if isRGBA {
				pixRowOffset := (actualY - rgbaImg.Bounds().Min.Y) * rgbaImg.Stride
				for x := 0; x < w; x++ {
					pixIdx := pixRowOffset + (x+rgbaImg.Bounds().Min.X)*4
					r := uint32(rgbaImg.Pix[pixIdx])
					g := uint32(rgbaImg.Pix[pixIdx+1])
					b := uint32(rgbaImg.Pix[pixIdx+2])
					// Fast integer ITU-R BT.601 luma
					luma := uint8((299*r + 587*g + 114*b) / 1000)
					if luma < 180 {
						bandRaster[bandOffset+x/8] |= 0x80 >> uint(x%8)
					}
				}
			} else {
				for x := 0; x < w; x++ {
					g := grayscale(img.At(img.Bounds().Min.X+x, img.Bounds().Min.Y+actualY))
					if g < 180 { // 1-bit high-contrast threshold for crisp Arabic text & QR codes
						bandRaster[bandOffset+x/8] |= 0x80 >> uint(x%8)
					}
				}
			}
		}

		// GS v 0 (raster bit image)
		out.Write([]byte{0x1d, 0x76, 0x30, 0x00})
		out.WriteByte(byte(rowBytes))
		out.WriteByte(byte(rowBytes >> 8))
		out.WriteByte(byte(bandHeight))
		out.WriteByte(byte(bandHeight >> 8))
		out.Write(bandRaster)
	}

	return out.Bytes(), nil
}

func decodeJPEGConfig(data []byte) (image.Config, error) {
	cfg, err := jpeg.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return image.Config{}, fmt.Errorf("invalid JPEG image: %w", err)
	}
	if cfg.Width <= 0 || cfg.Height <= 0 {
		return image.Config{}, fmt.Errorf("invalid JPEG dimensions %dx%d", cfg.Width, cfg.Height)
	}
	if cfg.Width > MaxJPEGDimension || cfg.Height > MaxJPEGDimension {
		return image.Config{}, fmt.Errorf("JPEG dimensions %dx%d exceed %d limit", cfg.Width, cfg.Height, MaxJPEGDimension)
	}
	pixels := int64(cfg.Width) * int64(cfg.Height)
	if pixels > MaxJPEGPixels {
		return image.Config{}, fmt.Errorf("JPEG pixel count %d exceeds %d limit", pixels, MaxJPEGPixels)
	}
	return cfg, nil
}

func resizeNearest(src image.Image, width int) image.Image {
	if width <= 0 || src.Bounds().Dx() <= width {
		return src
	}
	sw, sh := src.Bounds().Dx(), src.Bounds().Dy()
	h := max(1, int(math.Round(float64(sh)*float64(width)/float64(sw))))
	dst := image.NewRGBA(image.Rect(0, 0, width, h))
	for y := 0; y < h; y++ {
		sy := src.Bounds().Min.Y + y*sh/h
		for x := 0; x < width; x++ {
			sx := src.Bounds().Min.X + x*sw/width
			dst.Set(x, y, src.At(sx, sy))
		}
	}
	return dst
}

func grayscale(c color.Color) uint8 {
	r, g, b, _ := c.RGBA()
	// Integer approximation of ITU-R BT.601 luma.
	return uint8((299*r + 587*g + 114*b) / (1000 * 257))
}

// JPEGToPDF wraps the already-rendered JPEG as a single-page PDF. It is used
// for Windows print queues because the spooler implementation already has a
// PDF-aware path, while retaining the exact rasterized POS/Kitchen content.
func JPEGToPDF(data []byte) ([]byte, error) {
	return jpegToPDFWithReceiptPaper(data, 0, 0, 0)
}

// JPEGToPDFReceipt maps an Odoo POS receipt from browser CSS pixels to a
// physical roll. The old JPEGToPDF() interpreted every CSS pixel as 1/96in,
// making a 512px ticket ~135mm wide and causing Windows driver page
// substitutions or unexpected shrink/clipping on 58/80mm thermal printers.
//
// The native Windows queue remains authoritative for paper form support:
// the PDF backend verifies it accepts this *physical* page before StartDoc.
// Requires an explicitly configured physical width, printable dots and DPI.
func JPEGToPDFReceipt(data []byte, paperWidthMM, printableDots, dpi int) ([]byte, error) {
	if paperWidthMM <= 0 || paperWidthMM > 10000 || printableDots < 1 || printableDots > MaxJPEGDimension || dpi < 1 || dpi > 9600 {
		return nil, fmt.Errorf("receipt PDF requires explicit physical paper width, printable dots and DPI")
	}
	if float64(printableDots)*25.4/float64(dpi) > float64(paperWidthMM)+25.4/float64(dpi) {
		return nil, fmt.Errorf("printable dots exceed physical paper width at configured DPI")
	}
	return jpegToPDFWithReceiptPaper(data, float64(paperWidthMM), printableDots, dpi)
}

// JPEGToPDFGeometry uses the image's measured printer dots independently on
// each axis. It adds no invented physical margins or assumed browser DPI.
func JPEGToPDFGeometry(data []byte, geometry *Geometry) ([]byte, error) {
	if !geometry.PhysicalImageReady() {
		return nil, CapabilityMismatchf("image PDF requires measured paper_width_mm, dpi_x and dpi_y")
	}
	cfg, err := decodeJPEGConfig(data)
	if err != nil {
		return nil, err
	}
	if cfg.Width > geometry.PrintableWidthDots {
		return nil, CapabilityMismatchf("image exceeds measured printable width; render again with current geometry")
	}
	return jpegToPDF(data, 0, 0, 0, geometry)
}

func jpegToPDFWithReceiptPaper(data []byte, paperWidthMM float64, printableDots, dpi int) ([]byte, error) {
	return jpegToPDF(data, paperWidthMM, printableDots, dpi, nil)
}

func jpegToPDF(data []byte, paperWidthMM float64, printableDots, dpi int, geometry *Geometry) ([]byte, error) {
	cfg, err := decodeJPEGConfig(data)
	if err != nil {
		return nil, err
	}
	if cfg.Width <= 0 || cfg.Height <= 0 {
		return nil, fmt.Errorf("invalid JPEG dimensions %dx%d", cfg.Width, cfg.Height)
	}

	w, h := cfg.Width, cfg.Height

	// Preserve the encoded channel count. Go's supported four-component
	// JPEGs carry Adobe APP14 metadata and inverted CMYK samples (including
	// YCCK, whose transform is selected by DCTDecode from that marker).
	colorSpace := "/DeviceRGB"
	imageDecode := ""
	if cfg.ColorModel == color.GrayModel {
		colorSpace = "/DeviceGray"
	} else if cfg.ColorModel == color.CMYKModel {
		// Decode once to verify the supported Adobe color convention and the
		// complete image body. DecodeConfig alone only validates its header.
		// Keep the original JPEG stream; re-encoding could degrade barcodes.
		if _, err := jpeg.Decode(bytes.NewReader(data)); err != nil {
			return nil, fmt.Errorf("decode CMYK JPEG: %w", err)
		}
		colorSpace = "/DeviceCMYK"
		imageDecode = " /Decode [1 0 1 0 1 0 1 0]"
	}

	// Non-receipt documents keep the legacy 96-DPI image geometry.
	pageW := float64(w) * 72.0 / 96.0
	pageH := float64(h) * 72.0 / 96.0
	imageW, imageH := pageW, pageH
	imageX, imageY := 0.0, 0.0
	if paperWidthMM != 0 {
		if math.IsNaN(paperWidthMM) || math.IsInf(paperWidthMM, 0) || paperWidthMM <= 4 || printableDots <= 0 || dpi <= 0 {
			return nil, fmt.Errorf("invalid receipt media geometry")
		}
		pageW = paperWidthMM * 72.0 / 25.4
		// Explicit dot count and DPI define printable content width. Nominal
		// roll millimetres do not imply an extra hardware margin.
		contentMM := float64(printableDots) * 25.4 / float64(dpi)
		if contentMM <= 0 || contentMM > paperWidthMM+25.4/float64(dpi) {
			return nil, fmt.Errorf("printable width exceeds selected physical paper")
		}
		imageW = contentMM * 72.0 / 25.4
		imageH = imageW * float64(h) / float64(w)
		imageX = (pageW - imageW) / 2.0
		imageY = 2.0 * 72.0 / 25.4 // paper-feed margin at bottom
		pageH = imageH + 2.0*imageY
	}

	if geometry != nil {
		pageW = *geometry.PaperWidthMM * 72 / 25.4
		imageW = float64(w) * 72 / float64(*geometry.DPIX)
		imageH = float64(h) * 72 / float64(*geometry.DPIY)
		imageX = (pageW - imageW) / 2
		if geometry.OffsetXDots != nil {
			imageX = (float64(*geometry.OffsetXDots) + float64(geometry.PrintableWidthDots-w)/2) * 72 / float64(*geometry.DPIX)
		}
		imageY = 0
		pageH = imageH
		if imageX < 0 || imageX+imageW > pageW+1e-7 {
			return nil, fmt.Errorf("image lies outside measured physical paper")
		}
	}

	var b bytes.Buffer
	b.WriteString("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")
	offsets := make([]int, 6)
	writeObj := func(n int, body []byte) {
		offsets[n] = b.Len()
		fmt.Fprintf(&b, "%d 0 obj\n", n)
		b.Write(body)
		b.WriteString("\nendobj\n")
	}

	writeObj(1, []byte("<< /Type /Catalog /Pages 2 0 R >>"))
	writeObj(2, []byte("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"))
	pageBody := fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %.6f %.6f] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>", pageW, pageH)
	writeObj(3, []byte(pageBody))

	imageHeader := fmt.Sprintf("<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace %s%s /BitsPerComponent 8 /Filter /DCTDecode /Length %d >>\nstream\n", w, h, colorSpace, imageDecode, len(data))
	offsets[4] = b.Len()
	fmt.Fprintf(&b, "4 0 obj\n%s", imageHeader)
	b.Write(data)
	b.WriteString("\nendstream\nendobj\n")

	content := fmt.Sprintf("q\n%.6f 0 0 %.6f %.6f %.6f cm\n/Im0 Do\nQ\n", imageW, imageH, imageX, imageY)
	contentBody := fmt.Sprintf("<< /Length %d >>\nstream\n%sendstream", len(content), content)
	writeObj(5, []byte(contentBody))

	xref := b.Len()
	b.WriteString("xref\r\n0 6\r\n0000000000 65535 f\r\n")
	for i := 1; i <= 5; i++ {
		fmt.Fprintf(&b, "%010d 00000 n\r\n", offsets[i])
	}
	fmt.Fprintf(&b, "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", xref)
	return b.Bytes(), nil
}
