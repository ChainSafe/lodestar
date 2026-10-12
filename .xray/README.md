# Xray stream capture

Both network backends use the flags from [Lodestar #10298](https://github.com/ChainSafe/lodestar/pull/10298):

```sh
xray --ingest=/tmp/xray.sock --listen=127.0.0.1:9100 --static-dir=/path/to/xray/dashboard/dist
./lodestar beacon --network.backend=native --network.xrayAddress=/tmp/xray.sock --network.xrayWaitForAttach
```

Omit `--network.xrayWaitForAttach` to start without an attached collector. The
optional startup barrier times out after 30 seconds. TCP ingest uses `host:port`.
The collector endpoint receives plaintext streams, peer IDs and addresses; use
an operator-controlled Unix socket or private endpoint.

Capture observes negotiated application bytes, including gossip control messages
and request/response traffic. It excludes negotiation, QUIC packet headers and
retransmissions. Outbound timestamps describe transport acceptance, not delivery
to the remote peer; inbound timestamps describe application reads. The collector
decodes gossip and attributes request/response bytes by protocol. Configure its
genesis timestamp and slot duration for the chain; supply active Gloas fork
digests with `--gloas-fork-digests` when applicable.

The native owner copies bytes to a 16 MiB ring with 8192 event entries. Metadata
and drain storage scale with configured connections and streams and are charged
to the native memory budget. JavaScript drains up to four batches every 5 ms,
each at most 1 MiB or 512 events. Overflow drops buffered trace data and pauses
capture until the next drain supplies a complete live metadata snapshot. It does
not wait for collector I/O or change peer/network policy. The SDK separately
retains at most 16 MiB of encoded replay. These are best-effort traces, not a
durable audit log.

Reconnect replays retained events. After either capture or replay overflow,
existing streams are marked `capture_incomplete` until they close; new streams
remain decodable. Metrics expose `lodestar_xray_buffered_bytes`,
`lodestar_xray_errors_total{code}`, and, for native capture,
`lodestar_xray_dropped_bytes_total`. Capture is disabled and allocates no buffers
unless an address is supplied.

## Dependencies

Build the collector from the companion Xray checkout based on
[ethp2p/xray #1](https://github.com/ethp2p/xray/pull/1), commit `8816f48` or later.
The SDK requires its `supports_capture_gaps` handshake capability. The SDK changes
in `clients/js/src/stream.ts` add native events on the existing ingest/replay
implementation; no new collector format or Ethereum decoder is needed.

`probe-0.1.0.tgz` packages that SDK's source and compiled output until it is
published. Regenerate it from the companion checkout:

```sh
cd /path/to/xray/clients/js
npm ci
npm run build
npm pack --pack-destination /path/to/lodestar/.xray
cd /path/to/lodestar
mv .xray/xray-probe-0.1.0.tgz .xray/probe-0.1.0.tgz
pnpm --filter @lodestar/beacon-node add ../../.xray/probe-0.1.0.tgz --ignore-scripts
```

Refresh the archive integrity in `pnpm-lock.yaml` when replacing the package.
Keep `tarball: file:.xray/probe-0.1.0.tgz` in its resolution so frozen installs
resolve the local archive. Docker copies `.xray` before installing dependencies.
The two libp2p patches carry
[libp2p/js-libp2p #3650](https://github.com/libp2p/js-libp2p/pull/3650) for the
fallback backend: global middleware registration and per-stream middleware
arrays. Replace the archive and patches with registry versions once released.

The catalog pins Lodestar-z with `traceStreams` and `drainStreamTrace()`.
For native development, link the adjacent checkout and rebuild its addon.

## Validation

Build the native addon, link the adjacent Lodestar-z checkout, and build the
beacon-node package before testing worker mode:

```sh
pnpm --filter @lodestar/beacon-node build
XRAY_BINARY=/absolute/path/to/xray pnpm vitest run --project e2e packages/beacon-node/test/e2e/network/xray.test.ts
XRAY_BINARY=/absolute/path/to/xray pnpm vitest run --project e2e-mainnet packages/beacon-node/test/e2e-mainnet/network/xrayNative.test.ts
```

The tests start a real collector, exchange gossip and repeated requests, and
check decoded traffic, attribution and shutdown. The fallback suite covers
TCP/QUIC with main-thread and worker ownership. SDK tests cover reconnect,
backpressure, gaps and timestamps. Native tests cover exact wire bytes, partial
writes, ring wraparound, overflow, stale handles and draining after shutdown.
