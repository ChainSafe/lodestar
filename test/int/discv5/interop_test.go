package interop

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"net"
	"net/netip"
	"os"
	"os/exec"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/p2p/discover"
	"github.com/ethereum/go-ethereum/p2p/enode"
	"github.com/ethereum/go-ethereum/p2p/netutil"
)

const packetLimit = 128

var errPacketLimit = errors.New("interop packet budget exhausted")

type localSocket struct {
	*net.UDPConn
	reads  atomic.Uint32
	writes atomic.Uint32
}

func (c *localSocket) ReadFromUDPAddrPort(b []byte) (int, netip.AddrPort, error) {
	if c.reads.Add(1) > packetLimit {
		return 0, netip.AddrPort{}, errPacketLimit
	}
	return c.UDPConn.ReadFromUDPAddrPort(b)
}

func (c *localSocket) WriteToUDPAddrPort(b []byte, addr netip.AddrPort) (int, error) {
	if !addr.Addr().IsLoopback() {
		return 0, errors.New("interop destination is outside loopback")
	}
	if c.writes.Add(1) > packetLimit {
		return 0, errPacketLimit
	}
	return c.UDPConn.WriteToUDPAddrPort(b, addr)
}

type boundedOutput struct{ bytes.Buffer }

func (b *boundedOutput) Write(p []byte) (int, error) {
	remaining := 4096 - b.Len()
	if remaining > 0 {
		_, _ = b.Buffer.Write(p[:min(len(p), remaining)])
	}
	return len(p), nil
}

func TestGethInterop(t *testing.T) {
	binary := os.Getenv("DISCV5_INTEROP_BIN")
	if binary == "" {
		t.Fatal("set DISCV5_INTEROP_BIN to the built discv5_interop executable")
	}
	for _, mode := range []string{"zig-first", "geth-first", "zig-unadvertised"} {
		t.Run(mode, func(t *testing.T) { runInterop(t, binary, mode) })
	}
}

func runInterop(t *testing.T, binary, mode string) {
	t.Helper()
	key, err := crypto.HexToECDSA(strings.Repeat("22", 32))
	if err != nil {
		t.Fatal(err)
	}
	db, err := enode.OpenDB("")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	udp, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	defer udp.Close()
	conn := &localSocket{UDPConn: udp}
	local := enode.NewLocalNode(db, key)
	local.SetStaticIP(net.IPv4(127, 0, 0, 1))
	local.SetFallbackUDP(udp.LocalAddr().(*net.UDPAddr).Port)
	restrict, err := netutil.ParseNetlist("127.0.0.0/8")
	if err != nil {
		t.Fatal(err)
	}
	geth, err := discover.ListenV5(conn, local, discover.Config{
		PrivateKey:      key,
		NetRestrict:     restrict,
		V5RespTimeout:   time.Second,
		PingInterval:    time.Hour,
		RefreshInterval: time.Hour,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer geth.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, binary, mode, geth.Self().String())
	var stderr boundedOutput
	cmd.Stderr = &stderr
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	lines := make(chan string, 8)
	finished := make(chan error, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 1024), 1024)
		for count := 0; count < cap(lines) && scanner.Scan(); count++ {
			lines <- scanner.Text()
		}
		close(lines)
		finished <- errors.Join(scanner.Err(), cmd.Wait())
	}()
	waited := false
	defer func() {
		cancel()
		if !waited {
			<-finished
		}
		if t.Failed() {
			t.Logf("Zig stderr: %s", stderr.String())
		}
	}()

	readLine := func() string {
		t.Helper()
		select {
		case line, ok := <-lines:
			if !ok {
				t.Fatal("Zig helper closed stdout before completing the protocol")
			}
			return line
		case <-ctx.Done():
			t.Fatal("Zig helper exceeded the 12-second deadline")
			return ""
		}
	}
	first := readLine()
	if !strings.HasPrefix(first, "ENR enr:") {
		t.Fatalf("expected signed Zig ENR, got %q", first)
	}
	peer, err := enode.Parse(enode.ValidSchemes, strings.TrimPrefix(first, "ENR "))
	if err != nil {
		t.Fatalf("geth rejected Zig ENR signature: %v", err)
	}
	if mode != "zig-unadvertised" && (!peer.IP().IsLoopback() || peer.UDP() == 0) {
		t.Fatalf("invalid Zig endpoint: %v", peer)
	}

	checkZig := func() {
		t.Helper()
		for _, want := range []string{"ZIG_PONG", "ZIG_ENR"} {
			if got := readLine(); got != want {
				t.Fatalf("expected %s, got %q", want, got)
			}
		}
	}
	if mode == "zig-unadvertised" {
		if peer.IP() != nil || peer.UDP() != 0 {
			t.Fatal("expected address-less Zig ENR")
		}
		checkZig()
	} else {
		if mode == "zig-first" {
			checkZig()
		}
		pong, err := geth.Ping(peer)
		if err != nil {
			t.Fatalf("geth PING to Zig failed: %v", err)
		}
		if pong.ENRSeq != peer.Seq() {
			t.Fatalf("PONG ENR sequence: got %d, want %d", pong.ENRSeq, peer.Seq())
		}
		if pong.ToPort != uint16(udp.LocalAddr().(*net.UDPAddr).Port) || !net.IP(pong.ToIP).Equal(net.IPv4(127, 0, 0, 1)) {
			t.Fatalf("PONG observed endpoint mismatch: %v:%d", pong.ToIP, pong.ToPort)
		}
		returned, err := geth.RequestENR(peer)
		if err != nil {
			t.Fatalf("geth FINDNODE[0] to Zig failed: %v", err)
		}
		if returned.String() != peer.String() {
			t.Fatalf("FINDNODE[0] returned a different signed ENR: %v", returned)
		}
		if mode == "geth-first" {
			checkZig()
		}
	}
	if got := readLine(); got != "DONE" {
		t.Fatalf("expected DONE, got %q", got)
	}
	select {
	case err := <-finished:
		waited = true
		if err != nil {
			t.Fatalf("Zig helper failed: %v", err)
		}
	case <-ctx.Done():
		t.Fatal("Zig helper did not exit after completing the protocol")
	}
	if conn.writes.Load() > packetLimit || conn.reads.Load() > packetLimit {
		t.Fatal(errPacketLimit)
	}
	t.Logf("validated %s PING/PONG and signed self ENR; geth sent %d UDP packets", mode, conn.writes.Load())
}
