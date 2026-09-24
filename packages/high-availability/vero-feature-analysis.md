# Vero: Feature Analysis Relative to Lodestar (High-Availability Focus)

Vero is Serenita's multi-node validator client, written in Python. Its stated purpose is to protect validators from consensus client bugs by cross-checking chain state across several beacon nodes before attesting. This document records the features Vero offers that the Lodestar validator client does not, with emphasis on redundancy and high availability (HA) at the validator layer and the signer layer. Lodestar gaps are cited as `L1`..`L16` from the [Lodestar HA baseline](./lodestar-ha-baseline.md).

Snapshot: Vero `v1.4.1` plus unreleased master at commit `71a6176f`, cloned 2026-09-24 to `packages/high-availability/.research/vero`. The Dirk sidecar discussed in section 2 is `jshufro/remote-signer-dirk-interop` `v0.1.1` at commit `8b9aac13`, cloned to `.research/remote-signer-dirk-interop`. Paths below are relative to `.research/`. Claims marked "docs only" come from Vero's documentation and could not be verified in code.

## Executive summary

- **Beacon node layer is active-active.** Every configured node is used every slot. Attestation data must be agreed by a configurable threshold of nodes (default strict majority). Blocks are produced on every node and the highest-value one is published. Aggregates and sync contributions are best-of-N by participation. All submissions fan out to every node. Lodestar queries one node while it is healthy (`L1`, `L3`, `L4`).
- **Attestation consensus is the core differentiator.** Vero refuses to attest unless a threshold of nodes agree on source and target checkpoints, and falls back to requiring byte-identical attestation data. A minority-client bug cannot make Vero sign a bad vote. Lodestar has no equivalent (`L4`).
- **Slashing detection halts the client.** Vero subscribes to `attester_slashing` and `proposer_slashing` events on every node and stops all attestation and proposal duties if any of its validators is slashed. Lodestar has no such mechanism (`L11`).
- **Validator-layer redundancy is not open source.** Multiple Vero instances for the same keys are only supported through two sponsor-exclusive, closed-source components: Devo, a quorum-based distributed slashing protection service that enables active-active operation, and Automatic Failover, an experimental primary/secondary mode. The open-source client has no coordination, no health endpoint and no leader election.
- **Signer layer is a hard single point of failure.** Vero is remote-signer only, accepts one signer URL, has no signer failover or retry, and keeps no slashing protection of its own. Threshold signing via Dirk is possible only through an unaudited third-party sidecar that Vero's docs do not recommend for production.
- **Operational maturity is high.** Per-host metrics for every beacon node and the signer, two Grafana dashboards, OpenTelemetry tracing, duty-aware graceful shutdown, duty caching across restarts, and a Sigma Prime security assessment.

## Architecture

Vero runs as a single asyncio process. A `MultiBeaconNode` wrapper holds one `BeaconNode` client per URL plus an optional separate set of proposal-only nodes (`vero/src/providers/multi_beacon_node.py`). Duty services for attestation, aggregation, sync committee and block proposal are scheduled by APScheduler and driven by an `EventConsumer` that subscribes to the SSE stream of every node. All signing goes through a `RemoteSigner` client speaking the Ethereum Remote Signing API. Per-validator configuration lives in a small SQLite database when the Keymanager API is enabled. Supported forks are Electra and Fulu only; Gloas is not present (`vero/src/providers/beacon_chain.py:45-67`).

## 1. Beacon node layer

### 1.1 Comparison

| Capability                                           | Vero                                          | Lodestar                              | Gap     |
| ---------------------------------------------------- | --------------------------------------------- | ------------------------------------- | ------- |
| Multiple beacon nodes                                | Yes, all used concurrently every slot         | Yes, primary with cold fallbacks      | L1      |
| Separate proposal-only node list                     | Yes, `--beacon-node-urls-proposal`            | No                                    | L13     |
| Attestation data agreement across nodes              | Yes, configurable threshold, default majority | No                                    | L4      |
| Block produced on all nodes, best by value published | Yes                                           | No                                    | L3, L13 |
| Aggregates and sync contributions best-of-N          | Yes                                           | No                                    | L3      |
| Submissions fan out to all nodes                     | Yes, success if any accepts                   | No                                    | L3      |
| Event stream on every node with de-duplication       | Yes                                           | First URL only                        | L2      |
| Per-node scoring                                     | +1 success, -5 failure, clamped 0..100        | +1 success, -2 failure, clamped 0..10 | L5      |
| Degraded node evicted from fan-out                   | No, only affects single-node picks            | n/a                                   |         |
| Per-node spec check at startup                       | Yes, per node, overridable                    | Yes, against whichever node answers   |         |
| Optimistic responses rejected                        | Yes, everywhere                               | Sync committee only                   |         |
| Auth or mTLS to beacon nodes                         | No flags                                      | Basic auth in URL only                | L14     |

### 1.2 Request distribution model

Vero has three distribution primitives (`vero/src/providers/multi_beacon_node.py:1-34`, `:187-253`):

- **First response wins.** Fan out to all initialized nodes, return the first success, cancel the rest. Used for validator status lookups.
- **All responses.** Gather from every node, succeed if at least one succeeds, log the failures. Used for every publish call, subnet subscriptions, `prepare_beacon_proposer`, aggregate and contribution production, and block production.
- **Best node.** The single highest-scoring node, ties broken by list order. Used for duty fetching, block root lookups and validator registrations. A warning is logged whenever the best node is not the first in the list.

Nodes are initialized with an infinite retry every 5 seconds. Startup waits until the consensus threshold of nodes is initialized, with a 300 second deadline (`multi_beacon_node.py:112-159`). Once initialized, a node is never evicted from fan-out even at score zero (`multi_beacon_node.py:196-198`). Score only influences the "best node" picks.

Relative to Lodestar: Lodestar's fallback client waits a full request timeout before contacting a fallback the first time the primary fails, and pins the event stream to the first URL. Vero has no cold-failover latency because every request already goes to every node, and a dead node simply contributes nothing.

### 1.3 Attestation consensus algorithm

Configured by `--attestation-consensus-threshold`, default `len(urls) // 2 + 1` (`vero/src/args.py:59-75`). The whole routine is bounded by the start of the next slot; on timeout the slot's attestations are not published and `vc_attestation_consensus_failures_total` increments (`vero/src/services/attestation.py:153-174`).

**Path A, a head event has been seen for the slot** (`vero/src/providers/attestation_data_provider.py:123-179`):

1. Every node is polled for attestation data at least every 50 ms until one returns a `beacon_block_root` equal to the head event's root. The first match wins. Outer timeout 0.5 seconds.
2. Source and target checkpoints are confirmed. If they match cached checkpoints for their epochs, done. Otherwise every node is polled until `threshold` distinct nodes return the same source and target. Outer timeout 1.0 second. Successful checkpoints are cached per epoch.
3. Either timeout falls back to Path B.

**Path B, no head event by the one-third slot deadline, or Path A failed** (`multi_beacon_node.py:502-567`):

- Attestation data is requested from all nodes in rounds. Each node's latest answer is one vote keyed on the entire `AttestationData` struct. As soon as any value reaches `threshold` votes it is returned. Rounds are rate limited to 30 ms and the loop is bounded only by the slot deadline.

Guards: the checkpoint cache is invalidated on any `chain_reorg` that crosses an epoch boundary; checkpoints with a future epoch are rejected; when a slot has no attester duty but later slots in the epoch do, Vero still runs the routine early to warm the cache (`attestation.py:368-382`). Per-host `checkpoint_confirmations_total` shows which clients are confirming.

Documented consequence: with two nodes and threshold two, losing either node stops attestations at the next epoch boundary, because checkpoint confirmation needs both. Vero recommends at least three client pairs, no single client implementation holding a majority, and round-trip times under about 200 ms (`vero/docs/docs/usage/setup_recommendations/`).

### 1.4 Block production across nodes

`GET /eth/v3/validator/blocks/{slot}` is fired at every node (or every proposal node) concurrently. Vero waits up to half an interval (2 seconds on mainnet) collecting responses, then publishes the block with the highest `consensus_block_value + execution_payload_value`. On Gnosis only consensus value is compared. If nothing arrives by the timeout it waits for the first block. Blocks are not cross-validated between nodes; selection is purely by reported value (`multi_beacon_node.py:325-459`). Publishing fans out to all proposal nodes and succeeds if any accepts.

### 1.5 Event stream

Topics `head`, `chain_reorg`, `attester_slashing` and `proposer_slashing` are subscribed on every node. Events are de-duplicated by a bounded deque of keys and events for past slots are dropped (`vero/src/services/event_consumer.py:43-96`). On stream error the node loses 5 points and resubscribes after 10 seconds. The `head_event_time{host}` histogram records how far into the slot each node emitted its head, which directly exposes a lagging node. Vero's own CLI reference still says the event stream is single-node; the code is not.

### 1.6 Dedicated proposal nodes

`--beacon-node-urls-proposal` names nodes used only for block production and publishing, for example nodes wired to MEV-Boost or with a different execution client. They are initialized at startup but do not count toward the attestation threshold (`multi_beacon_node.py:95-101`, `:344-350`).

## 2. Signer layer

### 2.1 Comparison

| Capability                          | Vero                                      | Lodestar                             | Gap |
| ----------------------------------- | ----------------------------------------- | ------------------------------------ | --- |
| Local keystores                     | No, by design                             | Yes                                  |     |
| Remote signer protocol              | Ethereum Remote Signing API               | Same                                 |     |
| Multiple signer URLs for one key    | No                                        | No                                   | L6  |
| Signer failover or retry            | No                                        | No                                   | L6  |
| Signer request timeout              | Yes, 5 s high priority, 10 s low priority | No                                   | L6  |
| Priority-separated connection pools | Yes                                       | No                                   |     |
| Signer health polling               | Yes, every second, metrics only           | `upcheck` exists but never called    | L6  |
| Auth or mTLS to signer              | No                                        | No                                   | L6  |
| Threshold signing                   | Only via third-party Dirk sidecar         | No                                   | L7  |
| Key discovery from signer           | Every epoch                               | Every `fetchInterval`, default epoch |     |

### 2.2 Remote signer behaviour

Vero "never has direct access to validator keys" and requires exactly one of `--remote-signer-url` or `--enable-keymanager-api` (`vero/src/args.py:153-158`). Endpoints used are `publicKeys`, `sign/{pubkey}` with `Accept: text/plain`, and `healthcheck` (`vero/src/providers/remote_signer.py:28-29`, `:197-270`, `:321-353`).

Notable behaviours Lodestar lacks:

- **Two connection pools.** Block, RANDAO, attestation and sync message signing use a high-priority session with a 5 second timeout and an unbounded connector. Everything else uses a low-priority session limited to 10 connections with a 10 second timeout, sized around Web3Signer's default of 20 worker threads (`remote_signer.py:70-75`, `:115-151`).
- **Fast-then-slow publishing.** Attestations and sync messages are signed per validator concurrently, whatever is signed within 0.5 seconds is published immediately, and the rest follows in a second batch, so a slow signer does not hold back the majority (`vero/src/services/validator_duty_service.py:191-229`).
- **Process pool for large batches.** More than 100 signatures are offloaded to a process pool that opens its own signer session (`remote_signer.py:272-319`).
- **Health score.** `healthcheck` is polled every second; a healthy reply adds 1, anything else subtracts 20. The score is exported as `remote_signer_score{host}` but does not affect routing (`remote_signer.py:321-372`).

There is no fallback URL and no retry. A failed attestation or sync signature is skipped for that slot; a failed block or RANDAO signature aborts the proposal (`attestation.py:229-238`, `block_proposal.py:355-365`). In Keymanager mode different keys can be bound to different signer URLs, but each key still has exactly one.

### 2.3 Dirk through the remote-signer-dirk-interop sidecar

Vero's FAQ states Dirk is not compatible because Dirk does not implement the Remote Signing API, and points to an unaffiliated translator that is "not recommended for production usage at this point" (`vero/docs/docs/introduction/faqs.md:49-64`). The sidecar is a Go HTTP service that implements `publicKeys`, `sign/{identifier}`, a static `healthcheck` and `metrics`, and forwards every request to a Dirk cluster through the `go-eth2-wallet-dirk` library (`remote-signer-dirk-interop/pkg/service/service.go`, `pkg/dirksigner/dirk-signer.go`).

How it works:

- At startup it opens one Dirk wallet by name against all configured Dirk endpoints over mandatory mTLS, lists the accounts, and exposes each distributed account's composite public key (`pkg/dirksigner/dirk/dirk.go:29-34`, `:89-125`). Keys are refreshed on every `publicKeys` call, which Vero makes every epoch.
- `ATTESTATION` and `BLOCK_V2` map to Dirk's slashing-protected `SignBeaconAttestation` and `SignBeaconProposal`. All other types are hashed locally and sent through `SignGeneric` (`dirk-signer.go:137-163`, `:232-360`).
- Fan-out, partial signature collection and threshold recombination are entirely inside the library. One `dirk.timeout` bounds the whole operation; there are no per-endpoint deadlines and no retries (`config/config.go:25-29`, `pkg/service/service.go:85-94`). The end-to-end test signs through five Dirk daemons and asserts a deterministic composite signature (`test/end-to-end_test.go:218-256`).

Caveats that matter for HA:

- The `healthcheck` always returns UP regardless of Dirk reachability (`main.go:90-96`), so Vero's signer score cannot detect a down cluster.
- Dirk rule denials surface as generic HTTP 500, indistinguishable from outages; the defined 412 slashing code is never raised (`pkg/errors/errors.go:17-41`, `dirk-signer.go:165-168`).
- The listener toward the VC is plaintext with no authentication (`README.md:33-35`).
- Epoch is computed as `slot / 32` throughout, which is wrong for Gnosis (`dirk-signer.go:185`, `:239`, `:344`).
- Unaudited and AGPL licensed. The README notes it can be combined with Vouch's multi-instance configuration to run Vero and Vouch against the same Dirk cluster, using Dirk's threshold as the shared coordination point.

The sidecar gives Vero threshold-protected keys, but it is itself a new single point of failure in front of the cluster.

## 3. Slashing protection

| Capability                                          | Vero                                         | Lodestar                               | Gap    |
| --------------------------------------------------- | -------------------------------------------- | -------------------------------------- | ------ |
| Local slashing protection database                  | None                                         | Yes, always on                         |        |
| EIP-3076 import/export                              | No                                           | Yes                                    |        |
| Protection with remote signer                       | Entirely delegated to the signer             | Local DB plus whatever the signer does |        |
| Shared or replicated protection across VC instances | Devo, sponsor only, closed source            | No                                     | L8, L9 |
| Duplicate-duty guard within a process               | Yes, per slot for attestations and proposals | Implicit                               |        |

Vero's documentation is explicit: "The remote signer must be connected to a slashing protection database — Vero does not maintain its own!" The design rationale is that the signer's "battle-tested slashing protection database" prevents slashable offences "no matter what data Vero requests to sign" (`vero/docs/docs/introduction/risks.md`). Users switching from another client are told to move slashing protection data at the signer level or wait two finalized epochs.

**Devo (docs only).** A distributed slashing protection service that sits between Vero and duty publication. Vero submits proposed signing data to N Devo instances in parallel; each holds the latest attestation and block per validator, applies slashing rules, records the duty and approves. Vero proceeds only on quorum, for example 3 of 4. Because protection is externalized and replicated, several Vero instances can run active-active for the same keys with Devo as the shared coordination layer (`vero/docs/docs/sponsorship/features.md`). No Devo code exists in the repository.

## 4. Safety mechanisms

| Capability                        | Vero                                                     | Lodestar                                 | Gap |
| --------------------------------- | -------------------------------------------------------- | ---------------------------------------- | --- |
| Doppelganger detection            | Opt-in, all nodes queried, 2 to 3 epochs, aborts startup | Opt-in, one node, about 2 epochs, SIGINT | L10 |
| Slashing event detection and halt | Yes, all duties stop until restart                       | No                                       | L11 |
| Reject optimistic responses       | Yes, everywhere                                          | Sync committee only                      |     |
| Duty-aware graceful shutdown      | Yes, waits for imminent proposals and current duties     | Abort controller only                    |     |
| Independent security assessment   | Sigma Prime, 2026                                        | No published VC audit                    |     |

**Slashing detection** (`vero/src/services/validator_status_tracker.py:77-131`). Attester slashing events are intersected with the client's own indices; proposer slashings are matched on proposer index; validator status refreshes also check `active_slashed` and `exited_slashed`. Any hit sets a flag that makes every attestation and proposal call raise, for all managed validators. The flag is never cleared in code; recovery requires an operator restart, deliberately forcing review. Sync committee duties are not gated. A `----DANGER----disable-slashing-detection` flag exists.

**Doppelganger detection** (`vero/src/providers/doppelganger_detector.py:80-145`). Liveness is queried on every node for the current epoch immediately, then for epoch N+1 at the start of N+2, then again halfway through the last slot of N+2 to account for EIP-7045 inclusion windows. Any live index aborts startup. Keys added later through the Keymanager API are not checked until restart.

**Graceful shutdown** (`vero/src/shutdown.py`). On SIGINT or SIGTERM Vero waits for proposals due within three slots, then for the slot boundary, then for the current slot's duties, up to about 54 seconds on mainnet. The compose example sets a one minute stop grace period. This matters for HA because a restart or failover does not drop a proposal.

## 5. Duty scheduling relevant to HA

- **Duty cache across restarts.** Attester, proposer and sync duties plus dependent roots are persisted to the data directory on shutdown and loaded on start so a restarted instance can attest in its first slot (`vero/src/providers/duty_cache.py`).
- **Duty refresh with bounded retries.** Duty updates retry with 1 to 10 second backoff but release the lock at the epoch boundary; because the best node is re-evaluated on every call, a failing node's score drops and the next attempt goes elsewhere (`validator_duty_service.py:149-189`).
- **RANDAO pre-signed one slot ahead** and `prepare_beacon_proposer` plus validator registration re-sent in the slot before each proposal so a restarted beacon node still has the proposer's preferences (`block_proposal.py:120-140`, `:320-367`).
- **Selection proofs pre-signed at duty fetch**, due-soon first, with subnet subscriptions sent to all nodes (`attestation.py:533-607`).
- Vero's clock has no skew detection and relies on the host clock.

## 6. Block production and MEV relevant to HA

Vero never talks to relays; MEV goes through the beacon node and MEV-Boost. Registrations are spread across the epoch by `index % 32 == slot % 32`, sent in batches of 512 to the best node only to avoid duplicate relay registrations, and re-sent for the proposer in the slot before its duty (`block_proposal.py:243-318`). The builder boost factor defaults to 90 and is applied by the beacon node. Per-host histograms record each node's consensus and execution payload values, which shows when one node consistently builds worse blocks.

## 7. Observability relevant to HA

| Capability                                                           | Vero                                      | Lodestar                         | Gap |
| -------------------------------------------------------------------- | ----------------------------------------- | -------------------------------- | --- |
| Per-node score, version, head event timing, request rate and latency | Yes, labelled by host                     | Score and fallback counters only | L5  |
| Per-node consensus contribution                                      | `checkpoint_confirmations_total{host}`    | n/a                              |     |
| Signer health score and latency by request type                      | Yes                                       | Sign time and error counters     |     |
| Duty start and submission time histograms                            | Yes                                       | Step timing histograms           |     |
| Shipped Grafana dashboards                                           | Two                                       | Separate repository              |     |
| OpenTelemetry tracing                                                | Yes, one trace per proposal keyed by slot | No                               |     |
| Continuous profiling                                                 | Pyroscope                                 | No                               |     |
| Event loop lag monitoring                                            | Yes                                       | No                               |     |
| Health or readiness endpoint                                         | No                                        | No                               | L12 |

## 8. Multi-instance operation

The open-source client provides no way to run two instances for the same keys. The docs warn that "running validator keys in two different places will result in slashing" and describe Vero as "a single active validator process" that gathers input from multiple clients and decides in one place.

The sponsor-exclusive features change that picture (docs only, `vero/docs/docs/sponsorship/features.md`):

- **Devo** enables active-active. Each instance asks the Devo quorum before signing; the quorum's replicated per-validator records reject the second conflicting request.
- **Automatic Failover** is active-passive and experimental. The primary exposes a health check, the secondary monitors it and starts duties when the primary is unhealthy. Both must use the same Devo instances so the secondary continues against the same protection state.

Vero's own feature matrix lists "Active-active redundancy" as sponsor-only and "Distributed validator keys" as unsupported (`vero/docs/docs/introduction/why_vero.md:152-158`).

## 9. Features Lodestar has that Vero lacks

For completeness: local keystores and the local key manager routes, EIP-3076 import and export, a local slashing protection database, `--distributed` DVT aggregator selection support, Gloas support including PTC duties and in-protocol builders, builder selection strategies with per-key configuration, a proposer settings file, remote monitoring to beaconcha.in style endpoints, and a configuration file mechanism (Vero is flags only).

## 10. Takeaways for the Lodestar HA product

Features worth adopting, in rough priority order for HA:

1. Active-active beacon node usage with fan-out publishing and first-success reads, replacing the cold-fallback client (`L1`, `L3`).
2. Attestation data agreement across a configurable threshold of nodes, including checkpoint caching and the head-root fast path (`L4`).
3. Event stream subscription on every node with de-duplication (`L2`).
4. Slashing event detection with a hard stop on all slashable duties (`L11`).
5. Per-node health, head timing and contribution metrics, and a shipped dashboard (`L5`).
6. Duty-aware graceful shutdown and duty caching across restarts, both prerequisites for clean failover.
7. Signer request timeouts, priority pools and fast-then-slow publishing so a slow signer degrades rather than fails a slot (`L6`).
8. A dedicated proposal node list (`L13`).

Gaps Vero leaves open that a Lodestar HA product could fill in the open:

- An open-source equivalent of Devo: a replicated, quorum-approved slashing protection service that makes active-active validator instances safe (`L8`, `L9`).
- Signer redundancy for the same key: multiple signer URLs with health-based routing, and first-class threshold signing rather than a translator sidecar (`L6`, `L7`).
- A health and readiness endpoint on the validator process itself (`L12`).
- Eviction of persistently failing nodes from fan-out, which Vero does not do.
