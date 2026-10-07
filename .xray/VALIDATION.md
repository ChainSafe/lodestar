# Validation, 2026-10-07

The integration was validated across Lodestar, the Node.js probe, and the Go
collector before the upstream PRs and Lodestar draft were opened.

## Automated checks

- js-libp2p: workspace build, lint on changed files, 15 registrar tests, and 20
  connection tests pass.
- Xray SDK: type checks, formatting, build, and 9 tests pass. Coverage includes
  replay after disconnect, retention overflow while running, first buffered reads,
  backpressure, read-ahead, half-close, reset, shutdown, address validation, and
  rejection of collectors without capture-gap support.
- Xray collector: `go test ./...`, targeted race checks, and protobuf compatibility
  checks pass. Tests use serialized Lodestar fixtures from the pinned `unstable`
  base for Electra, Fulu, and Gloas; a fragmented 2 MiB gossip RPC is also covered.
- Lodestar: lint, beacon-node and CLI type checks, documentation formatting,
  87 targeted unit tests, and 36 networking end-to-end tests pass. Two existing
  network tests remain marked TODO.
- The real-collector interoperability test passes all four combinations of
  TCP/QUIC and main/worker networking, including repeated request/response streams.
- A clean Docker build and frozen-lockfile installation work with the local SDK
  archive. The archive matches the companion SDK source and compiled files.

The existing network test harness emits process-listener warnings, including
with capture disabled. Buf's schema style lint reports three existing issues:
its package directory and two enum-zero names. The protobuf compatibility check
passes; the new fields are additive and old Go probes still connect.

## Live devnet

Two Lodestar/geth pairs with 256 validators ran Fulu at six-second slots. At the
acceptance checkpoint, both had head slot 137, zero sync distance, execution online,
and the same finalized epoch-2 root.

Each source recorded 139 slots, about 81,000 gossip publications, and 18.4 MB of
traffic. Both had zero `decode_error` and zero `capture_incomplete` entries.
Blocks, attestations, aggregates, sync committee traffic, and raw request/response
traffic appeared in the collector.

Restarting only the collector restored both sources' saved slot-20 summaries and
breakdowns exactly from the probes' replay buffers. The dashboard built and was
served successfully over HTTP. A browser was unavailable for visual inspection.

The test enclave is stopped. The acceptance report, reference slot, and collector
SQLite data were retained locally.
The final handshake guard also passes the real-collector TCP/QUIC worker matrix.

## Upstream dependencies

- Lodestar base: `unstable`, `01cc10ce70bc3c6cd3f6d6169a740330f5882f3d`.
- js-libp2p: `75a531e`, branch `wemeetagain/xray-stream-middleware`.
- Xray: `3bd6994`, branch `wemeetagain/lodestar-probe`.

The SDK remains unpublished. The local archive and libp2p patch make this branch
self-contained for testing. Replace them with upstream releases before marking
the Lodestar draft ready for review. Gloas decoding is tested against pinned SSZ fixtures;
the live devnet exercised Fulu.
