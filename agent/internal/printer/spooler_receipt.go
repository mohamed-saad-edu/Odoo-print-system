package printer

// Device units describe this driver's selected form, not the nominal roll or
// firmware head limit. Never round a 70/72mm form into an 80mm hardware claim.
func receiptPaperFromDeviceCaps(physicalDots, printableDots, horizontalDPI, offsetX int) (paperMM float64, dots, dpi int) {
	if physicalDots <= 0 || horizontalDPI <= 0 || printableDots <= 0 || offsetX < 0 || printableDots > physicalDots-offsetX {
		return 0, 0, 0
	}
	mm := float64(physicalDots) * 25.4 / float64(horizontalDPI)
	// shortcut: auto sizing covers 40–120mm forms; wider receipts need an explicit document media contract.
	if mm < 40 || mm > 120 {
		return 0, 0, 0
	}
	return mm, printableDots, horizontalDPI
}
