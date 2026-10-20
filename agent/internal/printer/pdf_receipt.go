package printer

import (
	"fmt"
	"math"

	pdfium "github.com/klippa-app/go-pdfium"
	"github.com/klippa-app/go-pdfium/enums"
	"github.com/klippa-app/go-pdfium/requests"
)

type pdfPagePlan struct {
	width, height float64
	paper         pdfPaper
	mode          []byte
	crop          *requests.RenderPageCrop
}

func (p pdfPagePlan) printableDestination(physicalW, physicalH, printableW, printableH, dpiX, dpiY, offsetX, offsetY int) (x, y, w, h int, err error) {
	width, height := p.width, p.height
	if p.crop != nil {
		width, height = p.crop.Width, p.crop.Height
	}
	x, y, w, h, err = pdfPrintableDestination(width, height, physicalW, physicalH, printableW, printableH, dpiX, dpiY, offsetX, offsetY)
	if p.crop != nil && err == nil {
		y = 0 // Receipts retain their own feed margins without centering down a long roll form.
	}
	return
}

// Only Agent-generated receipt PDFs reach this helper; remove blank side margins, never image pixels or feed margins.
func receiptPDFCrop(instance pdfium.Pdfium, page requests.Page, width, height float64) (*requests.RenderPageCrop, error) {
	if err := validatePDFPageDimensions(width, height); err != nil {
		return nil, err
	}
	count, err := instance.FPDFPage_CountObjects(&requests.FPDFPage_CountObjects{Page: page})
	if err != nil || count == nil || count.Count != 1 {
		return nil, fmt.Errorf("generated receipt PDF must contain exactly one image: %v", err)
	}
	object, err := instance.FPDFPage_GetObject(&requests.FPDFPage_GetObject{Page: page, Index: 0})
	if err != nil || object == nil {
		return nil, fmt.Errorf("read generated receipt image: %v", err)
	}
	kind, err := instance.FPDFPageObj_GetType(&requests.FPDFPageObj_GetType{PageObject: object.PageObject})
	if err != nil || kind == nil || kind.Type != enums.FPDF_PAGEOBJ_IMAGE {
		return nil, fmt.Errorf("generated receipt PDF object is not an image: %v", err)
	}
	bounds, err := instance.FPDFPageObj_GetBounds(&requests.FPDFPageObj_GetBounds{PageObject: object.PageObject})
	if err != nil || bounds == nil {
		return nil, fmt.Errorf("read generated receipt image bounds: %v", err)
	}
	left, bottom, right, top := float64(bounds.Left), float64(bounds.Bottom), float64(bounds.Right), float64(bounds.Top)
	for _, value := range []float64{left, bottom, right, top} {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return nil, fmt.Errorf("generated receipt image has invalid bounds")
		}
	}
	if left < 0 || bottom < 0 || right > width || top > height || right <= left || top <= bottom {
		return nil, fmt.Errorf("generated receipt image lies outside its page")
	}
	return &requests.RenderPageCrop{X: left, Width: right - left, Height: height}, nil
}
