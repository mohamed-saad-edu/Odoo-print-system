//go:build windows

package printer

import (
	"context"
	"fmt"
	"unsafe"

	"golang.org/x/sys/windows"
)

// spoolerDetectedReceiptPaper reads the *driver's currently configured form*
// and its printable dot width, rather than guessing from a POS80/58 product
// name. Printers configured for A4/Letter remain ordinary Windows queues.
// CreateDCW and GetDeviceCaps are bounded by the shared preflight watchdog:
// a hung driver cannot indefinitely stall the print executor.
func spoolerDetectedReceiptPaper(ctx context.Context, queue string) (paperMM float64, dots, dpi int) {
	var physicalDots, printableDots, horizontalDPI, offsetX int
	err := runPreflightBounded(queue, preflightTimeout, ctx, func() error {
		driver, err := windows.UTF16PtrFromString("WINSPOOL")
		if err != nil {
			return err
		}
		device, err := windows.UTF16PtrFromString(queue)
		if err != nil {
			return err
		}
		hdc, _, callErr := procCreateDCW.Call(
			uintptr(unsafe.Pointer(driver)), uintptr(unsafe.Pointer(device)), 0, 0,
		)
		if hdc == 0 {
			return fmt.Errorf("CreateDCW default printer media failed: %w", callErr)
		}
		defer procDeleteDC.Call(hdc)
		physicalDots = deviceCaps(hdc, capPhysicalWidth)
		horizontalDPI = deviceCaps(hdc, capLogPixelsX)
		printableDots = deviceCaps(hdc, capHorzRes)
		offsetX = deviceCaps(hdc, capPhysicalOffsetX)
		return nil
	})
	if err != nil {
		return 0, 0, 0
	}
	return receiptPaperFromDeviceCaps(physicalDots, printableDots, horizontalDPI, offsetX)
}
