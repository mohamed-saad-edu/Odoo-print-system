//go:build windows

package printer

import (
	"runtime"
	"testing"
	"unsafe"
)

// Exercise the real Win32 ABI and pixels without submitting a print job.
func TestGDIBitmapNativeTransfer(t *testing.T) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	for _, tc := range []struct {
		name            string
		width, height   int
		destW, destH, y int
	}{
		{"direct", 17, 11, 17, 11, 0},
		{"stretch", 17, 11, 34, 22, 3},
		{"POS80", 576, 853, 576, 853, 0},
		{"POS80 long form", 640, 828, 640, 828, 12677},
		{"office", 3516, 4550, 4800, 6211, 100},
	} {
		t.Run(tc.name, func(t *testing.T) {
			createDC := modGDI32.NewProc("CreateCompatibleDC")
			createDIB := modGDI32.NewProc("CreateDIBSection")
			selectObject := modGDI32.NewProc("SelectObject")
			deleteObject := modGDI32.NewProc("DeleteObject")
			flush := modGDI32.NewProc("GdiFlush")
			hdc, _, err := createDC.Call(0)
			if hdc == 0 {
				t.Fatalf("CreateCompatibleDC: %v", err)
			}
			defer procDeleteDC.Call(hdc)
			info := winBITMAPINFO{Header: winBITMAPINFOHEADER{
				BiSize:  uint32(unsafe.Sizeof(winBITMAPINFOHEADER{})),
				BiWidth: int32(tc.destW), BiHeight: -int32(tc.y + tc.destH),
				BiPlanes: 1, BiBitCount: 32,
			}}
			var bits unsafe.Pointer
			hbmp, _, err := createDIB.Call(hdc, uintptr(unsafe.Pointer(&info)), dibRGBColors, uintptr(unsafe.Pointer(&bits)), 0, 0)
			if hbmp == 0 || bits == nil {
				t.Fatalf("CreateDIBSection: %v", err)
			}
			defer deleteObject.Call(hbmp)
			previous, _, err := selectObject.Call(hdc, hbmp)
			if previous == 0 || int32(previous) == -1 {
				t.Fatalf("SelectObject: %v", err)
			}
			defer selectObject.Call(hdc, previous)
			src := make([]byte, tc.width*tc.height*4)
			for y := 0; y < tc.height; y++ {
				for x := 0; x < tc.width; x++ {
					i := (y*tc.width + x) * 4
					// Distinct, large quadrants detect reversal and channel errors.
					src[i], src[i+1], src[i+2] = 32, byte(64+128*(y/(tc.height/2+1))), byte(64+128*(x/(tc.width/2+1)))
				}
			}
			if err := drawBitmapToPrinter(hdc, src, tc.width, tc.height, tc.destW, tc.destH, 0, tc.y); err != nil {
				t.Fatal(err)
			}
			if ok, _, err := flush.Call(); ok == 0 {
				t.Fatalf("GdiFlush: %v", err)
			}
			out := unsafe.Slice((*byte)(bits), tc.destW*(tc.y+tc.destH)*4)
			for _, point := range [][2]int{{tc.destW / 4, tc.destH / 4}, {tc.destW * 3 / 4, tc.destH * 3 / 4}} {
				x, y := point[0], point[1]
				i := ((y+tc.y)*tc.destW + x) * 4
				wantG, wantR := byte(64+128*(y/(tc.destH/2+1))), byte(64+128*(x/(tc.destW/2+1)))
				if out[i] != 32 || out[i+1] != wantG || out[i+2] != wantR {
					t.Fatalf("pixel %d,%d = %v, want BGR %v", x, y, out[i:i+3], []byte{32, wantG, wantR})
				}
			}
		})
	}
}
