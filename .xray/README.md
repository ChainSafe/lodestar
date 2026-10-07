# Xray integration workspace

This branch integrates the Xray Node.js SDK into Lodestar's network core. Capture
is disabled unless an ingest address is supplied. The probe lives with libp2p in
both main-thread and worker mode, before networking starts.

```sh
xray --ingest=/tmp/xray.sock --listen=127.0.0.1:9100 --static-dir=/path/to/xray/dashboard/dist
./lodestar beacon --network.xrayAddress=/tmp/xray.sock --network.xrayWaitForAttach
```

Omit `--network.xrayWaitForAttach` to allow startup while the collector is offline.
The barrier times out after 30 seconds. TCP ingest uses `host:port`; both TCP and
QUIC libp2p traffic can be captured independently of the ingest transport.

The probe captures application stream bytes, including gossip and request/response
traffic. Transport encryption, muxing, and protocol negotiation are outside this
capture boundary. The collector decodes gossip and counts request/response bytes
by protocol. Configure its genesis timestamp and slot duration for custom networks.
For Gloas, also supply `--gloas-fork-digests` as described in the SDK README.

Metrics are `lodestar_xray_buffered_bytes` and `lodestar_xray_errors_total{code}`.
The replay buffer retains at most 16 MiB. Reconnect replays retained events;
retention gaps produce a snapshot and label existing streams `capture_incomplete`
until they close. New streams remain decodable. This is best-effort tracing.

## Local dependencies

`probe-0.1.0.tgz` is the locally built `@xray/probe` package, with its TypeScript
source, generated protobuf bindings, and compiled output. The relative archive
path and integrity are locked so a clean checkout and Docker build work without
an unpublished npm release. The package sources and tests belong in the Xray repo.
Regenerate it from the companion Xray checkout with:

```sh
.xray/stage-probe.sh /path/to/xray
```

`patches/libp2p@3.3.9.patch` contains the companion upstream changes: global stream
middleware, per-stream middleware array copies, append registration, and selective
removal. The copy fixes repeated inbound handlers mutating the registered chain.

This Lodestar PR remains a draft until the upstream dependencies are released:

- [Xray Node.js probe and collector support](https://github.com/ethp2p/xray/pull/1)
- [js-libp2p global stream middleware](https://github.com/libp2p/js-libp2p/pull/3650)

Before marking it ready for review, replace the archive and patch with released
dependencies and remove this staging directory and its Dockerfile copy. The local
archive and patch allow reviewers to reproduce the integration in the meantime.

## Validation

Build the collector from the companion Xray checkout and run:

```sh
pnpm --filter @lodestar/beacon-node build
XRAY_BINARY=/absolute/path/to/xray pnpm vitest run --project e2e packages/beacon-node/test/e2e/network/xray.test.ts
```

The test starts a real Go collector and two Lodestar networks for each combination
of TCP/QUIC and main/worker mode. It sends gossip and repeated request/response
streams, checks collector API attribution and peer metadata, and verifies shutdown.
Other relevant suites are `network/reqresp.test.ts`, `network/network.test.ts`, and
the CLI's `options/beaconNodeOptions.test.ts`.

Companion commits used for validation:

- Xray: `3bd6994` from [ethp2p/xray#1](https://github.com/ethp2p/xray/pull/1)
- js-libp2p: `75a531e` from [libp2p/js-libp2p#3650](https://github.com/libp2p/js-libp2p/pull/3650)
- Lodestar base: `unstable` at `01cc10ce70bc3c6cd3f6d6169a740330f5882f3d`

`devnet/main.star` runs two Lodestar/geth pairs with 256 validators on Fulu using
pinned ethereum-package and client versions. It expects local images
`lodestar:xray-01cc10ce` and `xray:lodestar-b7f562ad`. Build Lodestar with
`Dockerfile.dev`; build Xray with its Dockerfile, or package the tested collector
binary with the built dashboard at `/srv/dashboard`.

```sh
kurtosis run .xray/devnet --enclave lodestar-xray-interop --image-download always
kurtosis enclave inspect lodestar-xray-interop
```

Run the acceptance checks with the ports reported by enclave inspection:

```sh
python3 .xray/devnet/check.py http://127.0.0.1:XRAY_PORT http://127.0.0.1:BEACON_1_PORT http://127.0.0.1:BEACON_2_PORT
```

To restart just the collector, pass the devnet genesis timestamp from
`/eth/v1/beacon/genesis`:

```sh
kurtosis run .xray/devnet --main-file restart-collector.star --enclave lodestar-xray-interop --image-download always '{"genesis_time":GENESIS_TIMESTAMP}'
```

Check both beacon nodes for progressing heads and nonzero finalized epochs, both
Xray sources for connection status, and slot breakdowns for decoded traffic with
no `decode_error` or `capture_incomplete` entries. Stop only this enclave when done:

```sh
kurtosis enclave stop lodestar-xray-interop
```
