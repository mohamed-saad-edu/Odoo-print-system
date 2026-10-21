package printer

import (
	"fmt"
	"math"
)

// Bound one rendered page independently of backend, paper form and source size.
const maxPDFRenderPixels = 16_000_000 // <= 64 MiB of 32-bit pixel storage.

func renderBounds(printableWidth, printableHeight int) (int, int, error) {
	if printableWidth <= 0 || printableHeight <= 0 {
		return 0, 0, fmt.Errorf("printer reported invalid printable area %dx%d", printableWidth, printableHeight)
	}
	// Division avoids overflowing the input area for an extreme driver value.
	if printableWidth <= maxPDFRenderPixels/printableHeight {
		return printableWidth, printableHeight, nil
	}
	scale := math.Sqrt(float64(maxPDFRenderPixels) / float64(printableWidth) / float64(printableHeight))
	w := min(maxPDFRenderPixels, max(1, int(float64(printableWidth)*scale)))
	h := min(maxPDFRenderPixels, max(1, int(float64(printableHeight)*scale)))
	// Clamping a sub-pixel short side to one can break the area bound. Keep
	// both dimensions nonzero and shrink the long side to restore the budget.
	if w > maxPDFRenderPixels/h {
		if w >= h {
			w = maxPDFRenderPixels / h
		} else {
			h = maxPDFRenderPixels / w
		}
	}
	return w, h, nil
}
