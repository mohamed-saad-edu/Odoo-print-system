package printer

import "testing"

func TestPDFRenderBoundsKeepBudgetForExtremeAspectRatios(t *testing.T) {
	for _, size := range [][2]int{{1, 2_000_000_000}, {2_000_000_000, 1}, {2, 2_000_000_000}, {4960, 7016}, {640, 828}, {1, 1}} {
		w, h, err := renderBounds(size[0], size[1])
		if err != nil || w <= 0 || h <= 0 || w > size[0] || h > size[1] || w > maxPDFRenderPixels/h {
			t.Fatalf("source=%v yielded %dx%d outside pixel budget %d: %v", size, w, h, maxPDFRenderPixels, err)
		}
	}
}

func TestPDFRenderBoundsRejectInvalidSizes(t *testing.T) {
	for _, size := range [][2]int{{0, 1}, {1, 0}, {-1, 2}, {2, -1}} {
		if _, _, err := renderBounds(size[0], size[1]); err == nil {
			t.Fatalf("invalid size admitted: %v", size)
		}
	}
}
