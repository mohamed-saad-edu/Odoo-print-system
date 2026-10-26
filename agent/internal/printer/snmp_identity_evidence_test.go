package printer

import (
	"context"
	"net"
	"testing"
	"time"

	"github.com/gosnmp/gosnmp"
)

// Malformed Printer-MIB evidence must never authorize a reachable byte sink.
func TestSNMPProbeRequiresSuccessfulExactTypedIdentity(t *testing.T) {
	for _, tc := range []struct {
		name   string
		suffix string
		tag    gosnmp.Asn1BER
		status uint8
		want   bool
	}{
		{"valid", "", gosnmp.OctetString, 0, true},
		{"different_instance", ".1", gosnmp.OctetString, 0, false},
		{"wrong_type", "", gosnmp.ObjectIdentifier, 0, false},
		{"error_response", "", gosnmp.OctetString, 5, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			udp, err := net.ListenPacket("udp", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			defer udp.Close()
			tcp, err := net.Listen("tcp", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			defer tcp.Close()
			done := make(chan struct{})
			go func() {
				defer close(done)
				buffer := make([]byte, 4096)
				codec := &gosnmp.GoSNMP{Version: gosnmp.Version2c, Community: "public"}
				for {
					n, peer, err := udp.ReadFrom(buffer)
					if err != nil {
						return
					}
					req, err := codec.SnmpDecodePacket(buffer[:n])
					if err != nil {
						return
					}
					vars := make([]gosnmp.SnmpPDU, len(req.Variables))
					for i, requested := range req.Variables {
						value := interface{}([]byte("ESC/POS printer serial-123"))
						if tc.tag == gosnmp.ObjectIdentifier {
							value = "1.3.6.1.2.1"
						}
						vars[i] = gosnmp.SnmpPDU{Name: requested.Name + tc.suffix, Type: tc.tag, Value: value}
					}
					packet := gosnmp.SnmpPacket{Version: gosnmp.Version2c, Community: req.Community,
						PDUType: gosnmp.GetResponse, RequestID: req.RequestID, Variables: vars, Error: gosnmp.SNMPError(tc.status)}
					response, err := packet.MarshalMsg()
					if err != nil {
						return
					}
					_, _ = udp.WriteTo(response, peer)
				}
			}()
			defer func() { _ = udp.Close(); <-done }()
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			_, got := probeSNMPPrinterWithPort(ctx, "127.0.0.1", udp.LocalAddr().(*net.UDPAddr).Port, tcp.Addr().(*net.TCPAddr).Port)
			if got != tc.want {
				t.Fatalf("printer identity accepted = %v, want %v", got, tc.want)
			}
		})
	}
}
