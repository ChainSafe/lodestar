# Vouch: Feature Analysis Relative to Lodestar (High-Availability Focus)

Vouch is Attestant's multi-node validator client, written in Go. It is built around per-operation strategies that fan requests out to several beacon nodes and pick a result by score or majority, a submitter that publishes to every node, an embedded MEV relay service, and a signer layer that delegates entirely to Dirk. This document records the features Vouch offers that the Lodestar validator client does not, with emphasis on redundancy and high availability (HA). Dirk is analysed separately in [dirk-feature-analysis.md](./dirk-feature-analysis.md); this document covers only the Vouch side of joint behaviour. Lodestar gaps are cited as `L1`..`L16` from the [Lodestar HA baseline](./lodestar-ha-baseline.md).

Snapshot: Vouch `1.13.1-dev.3` at commit `64d4db5d`, cloned 2026-09-24 to `packages/high-availability/.research/vouch`. Two libraries carry load-bearing behaviour and were read at the versions pinned in Vouch's `go.mod`: `attestantio/go-eth2-client v0.29.0` (the `multi` failover client) and `wealdtech/go-eth2-wallet-dirk v1.6.0` (threshold signature composition). Paths below are relative to `.research/` unless prefixed with a library name.

## Executive summary

- **Redundancy is configured per operation, not per client.** Every fetch type has its own beacon node set and its own selection style: `best` (fan out and score), `majority` or `combinedmajority` (agree above a threshold, fail closed), `first` (first success), or the default `simple` (ordered failover). Lodestar has one client with one cold-fallback policy for everything (`L1`, `L3`, `L4`, `L13`).
- **Submission goes to every node and returns on the first success.** The `multinode` submitter publishes attestations, aggregates, proposals, sync messages and subscriptions to all configured nodes in parallel (`L3`).
- **Ordered failover with health probing.** The underlying multiclient deactivates a node on a non-4xx error, re-probes `/node/syncing` every 30 seconds, and re-activates nodes at the end of the list. Lodestar only discovers a dead fallback during a failover (`L1`, `L5`).
- **Multiple Vouch instances are supported without any Vouch-to-Vouch protocol.** The `multiinstance` service's `static-delay` style has passive instances wait into the slot, look for the active instance's work in the beacon node's attestation pool or block headers, and take over only if nothing is seen. Double-signing safety comes entirely from Dirk's rules, which deny any second attestation per target epoch and any second proposal per slot. Lodestar has nothing comparable (`L9`).
- **No slashing protection database, no doppelganger detection, no keymanager API.** Vouch's safety model assumes Dirk. Running Vouch on local wallets is explicitly unprotected.
- **Embedded MEV relay service.** Vouch runs its own builder API endpoint that beacon nodes call, with per-validator relay configuration fetched from a URL each epoch, bid scoring per builder, relay signature verification, and unblinding retries across relays.
- **Fast-track duties on head events with configurable delays**, hierarchical timeouts per operation and per node, OpenTelemetry tracing, and strategy selection metrics that show which node won each operation.

## Architecture

Vouch is a single Go daemon. `main.go` wires services from a viper configuration: a controller that schedules duties per epoch, an account manager (Dirk or local wallet), strategies per operation, a submitter, a block relay service, a graffiti provider, a cache of block roots to slots, and the multiinstance service. Beacon node HTTP clients are memoised per address and composed into `multi` clients per operation (`vouch/clients.go:37-112`). Configuration is hierarchical: a key such as `strategies.attestationdata.best.timeout` falls back to `strategies.attestationdata.timeout`, then `strategies.timeout`, then `timeout` (`vouch/util/timeout.go:25-40`). Forks are supported through Fulu; there is no Gloas code (`vouch/services/controller/standard/service.go:596-688`).

## 1. Beacon node layer

### 1.1 Comparison

| Capability                                                                 | Vouch                                                        | Lodestar                       | Gap    |
| -------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------ | ------ |
| Multiple beacon nodes                                                      | Yes, per-operation node sets                                 | Yes, one ordered list          | L13    |
| Ordered failover with active/inactive tracking                             | Yes, deactivate on non-4xx, re-probe every 30 s              | Score-gated racing, no probing | L1, L5 |
| Fan out and score (attestation data, proposals, aggregates, contributions) | Yes, `best` styles                                           | No                             | L3, L4 |
| Majority agreement on attestation data                                     | Yes, `majority` and `combinedmajority` with threshold        | No                             | L4     |
| Majority agreement on sync committee head root                             | Yes, `beaconblockroot` `majority` and `latest`               | No                             | L4     |
| Submission to all nodes, first success wins                                | Yes, `multinode` submitter, default                          | No                             | L3     |
| Client-specific benign error handling on submit                            | Yes, Lighthouse, Nimbus, Teku duplicates count as success    | No                             |        |
| Event stream                                                               | All active nodes subscribed, forwarded from the primary only | First URL only                 | L2     |
| Per-node and per-operation timeouts                                        | Yes, hierarchical                                            | One global timeout             | L14    |
| Start without any synced node                                              | Yes, `allow-delayed-start`, default on                       | Waits for genesis and spec     |        |

### 1.2 Multiclient failover semantics

The default `simple` style for any operation is a `go-eth2-client/multi` client (`vouch/main.go:314-327`). A node is active when `/eth/v1/node/syncing` reports not syncing, or head slot zero with sync distance at most one (`go-eth2-client/http/service.go:180-276`). Each call walks the active clients in configured order. A 4xx or a context deadline does not deactivate the node; any other error does, and the call moves to the next node. A monitor rechecks every client every 30 seconds and re-activated clients are appended to the end of the active list, so a recovered primary does not immediately regain priority (`go-eth2-client/multi/client.go:30-232`). Addresses unreachable at startup are logged and dropped rather than failing startup (`vouch/clients.go:88`).

Relative to Lodestar: both are ordered failover, but Vouch probes health continuously and demotes rather than races, so a dead fallback is known before it is needed and a flapping primary does not repeatedly cost a timeout.

### 1.3 Strategy framework

`best`, `majority`, `latest` and `combined` styles fire every provider in parallel with a soft timeout at half the configured timeout (return when any or enough responses arrived) and a hard timeout at the full value, default 2 seconds (`vouch/strategies/attestationdata/best/attestationdata.go:56-168`). `first` styles return the first success and cancel the rest. Every strategy records `vouch_strategy_operation_used_total{strategy,provider,operation}` so operators can see which node's answer was used (`vouch/services/metrics/prometheus/client.go:27-125`).

### 1.4 Strategy catalogue

| Operation                                | Styles                                                  | Selection algorithm                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `attestationdata`                        | `best`, `first`, `majority`, `combinedmajority`, simple | `best`: score is `source.epoch + target.epoch + 1/(1 + attSlot - headSlot)` using a block root to slot cache, so fresher heads and later checkpoints win (`best/score.go:13-54`). `majority`: group by hash tree root, early exit at strict majority, largest group wins, tie to higher head slot, error if the winning count is below `threshold` (`majority/attestationdata.go:44-144`). `combinedmajority`: group by source, target and slot first, then pick the most-voted head root inside the winning group (`combinedmajority/attestationdata.go:49-174`). |
| `aggregateattestation`                   | `best`, `first`, simple                                 | `best`: fraction of aggregation bits set.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `beaconblockproposal`                    | `best`, `first`, simple                                 | `best`: `ConsensusValue + ExecutionValue`; rejects a zero fee recipient; substitutes `{{CLIENT}}` in graffiti per node (`beaconblockproposal/best/beaconblockproposal.go:45-283`). The `execution-payload-factor` key is parsed but unused.                                                                                                                                                                                                                                                                                                                        |
| `beaconblockroot` (sync committee head)  | `first`, `latest`, `majority`, simple                   | `latest`: highest slot via cache. `majority`: most-voted root, early exit at absolute majority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `synccommitteecontribution`              | `best`, `first`, simple                                 | `best`: count of aggregation bits.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `signedbeaconblock`, `beaconblockheader` | `first`, simple                                         | First success; 404 and 503 treated as benign.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `attestationpool`                        | `combined`                                              | Union by root across nodes; used only by the multiinstance service.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `builderbid`                             | `best`, `deadline`                                      | See section 6.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Notes on thresholds: when `strategies.attestationdata.majority.threshold` is unset it defaults to zero, which means any single response passes, so the fail-closed behaviour must be configured explicitly (`majority/parameters.go:141-146`). There is no majority style for proposals or aggregates, and no cross-check of proposal content beyond value scoring.

### 1.5 Submitter

`submitter.style: multinode` is the default. Each submit call runs against every configured node for that operation in parallel and returns on the first success, or fails with "no successful submissions before timeout"; the remaining submissions continue in the background (`vouch/services/submitter/multinode/submitattestations.go:21-105`). Client-specific errors that indicate the node already has the message are counted as success, with the client detected via `/eth/v1/node/version` (`submitattestations.go:108-147`, `helpers.go:22-51`). Proposal preparations and validator registrations bypass the submitter and go to every node in the proposing set (`vouch/main.go:507-537`).

### 1.6 Event stream

The controller subscribes to `block` and `head` on a multiclient built from the attestation data node set, so timing signals come only from nodes Vouch attests from (`vouch/main.go:453-456`, `vouch/services/controller/standard/service.go:183-193`). The multiclient opens a stream to every active node but forwards only events whose source is the current primary; inactive nodes are polled every 5 seconds and subscribed once synced (`go-eth2-client/multi/events.go`). A caveat visible in the code: if the primary's stream dies while it still answers `/node/syncing`, nothing resubscribes it, and fast-tracking stops until that node is deactivated by a failed call. This is better than Lodestar's single-URL stream but is still forward-from-one.

## 2. Signer layer

### 2.1 Comparison

| Capability                                                | Vouch                                             | Lodestar                                       | Gap |
| --------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------- | --- |
| Local keys                                                | Yes, ethdo wallets, explicitly unprotected        | Yes, EIP-2335 keystores with local slashing DB |     |
| Remote signer protocol                                    | Dirk gRPC over mTLS                               | Ethereum Remote Signing API over plain HTTP    | L6  |
| Threshold signing for one key                             | Yes, m-of-n via Dirk, composed in Vouch           | No                                             | L7  |
| Signer failover for a standard key                        | No, request pinned to the endpoint that listed it | No                                             | L6  |
| Signer timeout                                            | Yes, `accountmanager.dirk.timeout`, default 30 s  | No                                             | L6  |
| Signer authentication                                     | mTLS client certificate                           | None                                           | L6  |
| Structured signing requests so the signer can apply rules | Yes                                               | Yes, Web3Signer receives typed payloads        |     |
| Batch signing                                             | Yes, per-account-unique batches                   | No, one request per signature                  |     |
| Key discovery from signer                                 | Every quarter epoch, all endpoints                | Every `fetchInterval`, default epoch           |     |

### 2.2 Account managers

Exactly one of `accountmanager.dirk` or `accountmanager.wallet` may be configured (`vouch/main.go:1116-1119`). The Dirk manager reports `HasSlashingProtection() == true`; the wallet manager reports `false` and logs a startup warning (`vouch/services/accountmanager/wallet/service.go:78-79`). Dirk configuration is `endpoints`, `accounts` (specifiers such as `wallet` or `wallet/Validator.*`), `client-cert`, `client-key`, `ca-cert` (majordomo URLs), `timeout` and `process-concurrency` (`vouch/services/accountmanager/dirk/service.go:68-137`).

### 2.3 Connectivity and discovery

Vouch loads one mTLS credential set for all Dirk endpoints (`dirk/service.go:140-166`). The library keeps a connection pool per Dirk address, default 128 connections (`go-eth2-wallet-dirk/connectionprovider.go:14-108`). Account discovery calls `ListAccounts` on every endpoint in parallel, merges, de-duplicates standard accounts by pubkey and distributed accounts by composite pubkey, and errors only if zero endpoints answered (`go-eth2-wallet-dirk/grpc.go:91-306`). Accounts are re-listed a quarter of the way through each epoch, every slot while no validators are known, and an empty result retains the previous list (`vouch/services/controller/standard/accountsrefresher.go`, `dirk/service.go:245-249`). Vouch therefore starts and keeps running with Dirk temporarily unreachable.

### 2.4 Threshold signing, Vouch's side

For a distributed account, Dirk's listing carries the signing threshold and the participant map (id to `host:port`) recorded at key generation. Participants come from that metadata, not from Vouch's `endpoints` list, so Vouch must be able to reach every participant (`go-eth2-wallet-dirk/distributedaccount.go:28-63`). To sign, the library acquires a pooled connection to every participant (any acquisition failure aborts the request), sends the request to all in parallel, and reads responses until `signed >= threshold` or everyone has answered, counting DENIED, FAILED and transport errors separately. It then recovers the composite signature by Lagrange interpolation over the participant ids (`grpc.go:1113-1235`). If fewer than `threshold` partials arrive, the error reads `not enough signatures: N signed, N denied, N failed, N errored`. The round timeout is `accountmanager.dirk.timeout`.

Batch variants sign many attestations across accounts with mixed thresholds in one round and return nil for any request short of threshold, which Vouch reports as "No signature for validator; not creating attestation" and skips (`grpc.go:1238-1433`, `vouch/services/attester/standard/attest.go`). Standard and distributed accounts are signed in separate all-or-none batches, with a code comment citing the need to avoid two Vouch instances each getting half of a batch (`vouch/services/signer/standard/helpers.go:251-300`).

Tolerance: with threshold m of n, up to n-m Dirk instances may be down, slow or denying and signing still completes as soon as m succeed. Vouch adds no retry beyond the duty schedule.

### 2.5 Protected versus generic signing

If the account implements the protecting-signer interface (Dirk accounts do), Vouch sends structured attestation data or block header fields so Dirk can run slashing rules; otherwise it hashes locally and calls a generic sign (`helpers.go:27-63`). Attestations, selection proofs, sync committee roots and contributions, and registrations are batched. Because Dirk rejects a batch containing the same pubkey twice, Vouch splits into per-account-unique batches (`helpers.go:71-248`).

### 2.6 Standard keys and multiple clusters

A standard (non-distributed) Dirk account is signed at the endpoint that listed it, with a fallback to the first wallet endpoint. Copying wallet files to several Dirks yields duplicate pubkeys, of which the library keeps the first, so failover for standard keys is not automatic (`grpc.go:216-240`, `:785-789`). One Vouch can drive several independent Dirk clusters as long as every participant is reachable, all accept the same client certificate, and at least one member of each cluster is in `endpoints`. There is no per-endpoint credential or timeout.

## 3. Slashing protection

| Capability                                | Vouch                                                                         | Lodestar                                    | Gap    |
| ----------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------- | ------ |
| Local slashing protection database        | None                                                                          | Yes, always on                              |        |
| EIP-3076 import/export                    | No                                                                            | Yes                                         |        |
| Protection enforced before remote signing | No, delegated to Dirk                                                         | Yes, locally, plus whatever the signer does |        |
| Shared protection across VC instances     | Yes, indirectly, through Dirk's per-instance rules plus the signing threshold | No                                          | L8, L9 |

Vouch has no signed-history store of any kind; a search for slashing in the Go sources finds only the capability flag and the wallet warning (`vouch/services/accountmanager/service.go:26-27`). Its contribution to safety is sending structured data to Dirk and never re-signing after a denial. What Vouch does have are in-memory guards: one attestation per validator per epoch per process, kept two epochs back, not persisted (`vouch/services/attester/standard/attest.go`); attestation data sanity checks (slot equals duty slot, source at most target, target at most duty epoch); and proposal slot must match duty.

The practical consequence for HA is that Vouch's multi-instance safety is only as good as the Dirk cluster's rules, described in the Dirk document.

## 4. Safety mechanisms

### 4.1 Comparison

| Capability                                         | Vouch                               | Lodestar            | Gap |
| -------------------------------------------------- | ----------------------------------- | ------------------- | --- |
| Multiple instances on the same keys                | Yes, `multiinstance` `static-delay` | No                  | L9  |
| Doppelganger detection                             | No                                  | Opt-in              |     |
| Slashing event detection and halt                  | No                                  | No                  | L11 |
| Sync committee inclusion verification              | Yes, metrics only                   | No                  |     |
| Graceful shutdown waits for in-flight attestations | Yes                                 | No                  |     |
| Optimistic head handling                           | Delegated to node sync state        | Sync committee only |     |

### 4.2 The multiinstance service

Introduced in 1.11.0, `vouch/services/multiinstance` exposes `ShouldAttest`, `OnAttestationFailure`, `ShouldPropose` and `OnProposalFailure`, consulted by the controller immediately before attesting or proposing and after a failure (`vouch/services/multiinstance/service.go:25-37`, `vouch/services/controller/standard/attester.go:139-149`). Aggregation, sync committee work, registrations and preparations are not gated; every instance does them.

The default style `always` returns true and only exports `vouch_multiinstance_active{operation}`. The `static-delay` style implements passive takeover (`vouch/services/multiinstance/staticdelay/`):

- **Initial state.** Attester and proposer are active only if their delay is zero. With the defaults of 1 second and 2 seconds, every instance starts passive and claims activity on its first duty if it sees nobody else acting (`service.go:79-83`).
- **`ShouldAttest`.** An active instance attests at once. A passive instance sleeps until 4 seconds into the slot, then `attester-delay` more, then queries the attestation pool (`/eth/v1/beacon/pool/attestations?slot&committee_index`, combined across nodes) for each committee it has duties in. If any of its validators' bits are already set, it stays passive and also deactivates its proposer. If nothing is found, it activates both attester and proposer and attests (`shouldattest.go:26-104`).
- **`ShouldPropose`.** A passive instance sleeps `proposer-delay`, fetches `GET /eth/v1/beacon/headers/{slot}`; if a block exists it stays passive, if the lookup errors it activates and proposes (`shouldpropose.go:26-60`).
- **Failure hooks.** An attestation failure deactivates attester and proposer; a proposal failure deactivates the proposer. Under Dirk, a DENIED response is a failure, so an instance that loses a race to another instance steps back automatically.

Properties of this model:

- No Vouch-to-Vouch communication, no leader election, no shared lock. Peers are inferred from artefacts visible in the beacon node. The docs require the beacon nodes to subscribe to all subnets so the pool is complete, and Vouch cannot verify that.
- A taking-over instance attests at 4 seconds plus `attester-delay` into the slot with no fast-track benefit, and proposes `proposer-delay` into the slot.
- Double-sign safety is not provided here. It relies on Dirk denying a second attestation per target epoch and a second proposal per slot for the same key. If two passive instances both see an empty pool at the same instant and both request signatures, Dirk approves at most one per instance, and the composite threshold decides which instance gets a usable signature; the other receives a denial and steps back.
- Metrics: `vouch_multiinstance_checks_total{operation,result}` and `vouch_multiinstance_active{operation}`.

### 4.3 Other guards

Proposal guards include a mandatory non-zero `blockrelay.fallback-fee-recipient` at startup, rejection of local proposals with a zero fee recipient, and builder bid validation (non-zero fee recipient, timestamp equals slot start, gas limit check, relay signature verification, value above `min_value`) (`vouch/strategies/builderbid/best/builderbid.go:444-591`). RANDAO and graffiti are deliberately not checked in returned blocks to tolerate DVT middleware and node rewrites. `controller.verify-sync-committee-inclusion` checks that Vouch's sync messages appear in the next block's aggregate, for metrics and logs only (`vouch/services/controller/standard/events.go:338-445`).

## 5. Duty scheduling relevant to HA

- **Fast track.** A `head` event for the current slot runs the attestation and sync message jobs after `controller.fast-track.grace` (500 ms) instead of waiting for the scheduled time (`controller/standard/events.go:145-172`).
- **Configurable delays.** `controller.max-attestation-delay` (4 s), `controller.attestation-aggregation-delay` (8 s), `controller.max-sync-committee-message-delay` (4 s), `controller.sync-committee-aggregation-delay` (8 s), `controller.max-proposal-delay` (0, with an early-proposal path when the previous slot's head is seen), and `attester.grace` to let several nodes catch up before fetching attestation data.
- **Preparation off the critical path.** The RANDAO reveal is signed via Dirk when duties are known, not at proposal time (`vouch/services/beaconblockproposer/standard/service.go`). Next-epoch duties and subscriptions are prepared at half-epoch.
- **Reorg handling.** Each current-slot head event compares both dependent roots; a change in the previous root reschedules this epoch's attestations, a change in the current root reschedules proposals, next-epoch attestations and sync committee jobs (`events.go:176-321`).
- **Graceful shutdown** waits for the current slot's pending attestations (`vouch/main.go:188-206`).
- Accounts unreachable at startup are retried each slot; Vouch never blocks on Dirk being up.

## 6. Block production and MEV

Vouch replaces MEV-Boost with an embedded block relay service that beacon nodes call as their builder endpoint (`blockrelay.listen-address`, default `0.0.0.0:18550`) (`vouch/services/blockrelay/standard/service.go`). Features Lodestar's VC has no counterpart for, because Lodestar leaves relay handling to the beacon node:

- **Execution configuration from a URL.** `blockrelay.config.url` is fetched at startup and each quarter epoch; for HTTP sources Vouch POSTs its validator pubkeys and can present a client certificate. A fetch failure keeps the previous configuration. Version 2 configuration carries defaults, per-relay settings (`public_key`, `fee_recipient`, `gas_limit`, `grace`, `min_value`, `disabled`) and per-proposer overrides matched by pubkey or account regex (`vouch/services/blockrelay/v2/`).
- **Builder scoring.** `blockrelay.builder-configs.<pubkey>` applies `(value + offset) * factor / 100` per builder, with factor zero excluding a builder (`vouch/main.go:1903-2016`).
- **Bid strategies.** `best` requests every relay after its grace period, filters and verifies bids, and scores them; `deadline` polls relays until a deadline into the slot, forwarding improved bids (`vouch/strategies/builderbid/`).
- **Validator registrations** are signed once per fee recipient, gas limit and pubkey, cached, and submitted to relays in parallel at a random point in the middle of the epoch. Registrations from beacon nodes for non-Vouch validators are forwarded per their proposer configuration, so Vouch can act as the relay front end for other validator clients too.
- **Unblinding** retries each candidate relay three times 250 ms apart and stops on a 400 (`vouch/services/beaconblockproposer/standard/propose.go:395-494`).

HA-relevant consequences: several Vouch instances can share one execution configuration source and produce identical registrations; the relay service is a per-instance component, so beacon nodes pointed at one Vouch's relay endpoint lose MEV if that instance is down; and a signed blinded block that fails unblinding cannot be replaced by a local block in the same slot because Dirk denies a second proposal (`propose.go:196-204`).

## 7. Validator and account management

- **No keymanager API.** Vouch exposes only the builder API listener and Prometheus. Accounts are discovered from Dirk or wallets by specifier; there is no add or remove API.
- **Graffiti providers.** `static` or `dynamic`, the latter fetching from a location with `{{SLOT}}`, `{{VALIDATORINDEX}}` and `{{CLIENT}}` templates per proposal (`vouch/services/graffitiprovider/dynamic/service.go:47-115`).
- **Secrets via majordomo.** Certificates, passphrases and configuration URLs may be `direct://`, `file://`, `http(s)://`, `gsm://` or `asm://` (`vouch/main.go:906-985`).
- **Runtime reload.** Accounts and validator states each epoch, execution configuration each epoch, graffiti each proposal, node active set every 30 seconds. Node lists, strategies and Dirk endpoints require a restart; there is no configuration file watch.

## 8. Observability relevant to HA

| Capability                                  | Vouch                                                              | Lodestar                       | Gap |
| ------------------------------------------- | ------------------------------------------------------------------ | ------------------------------ | --- |
| Which node's answer was used, per operation | `vouch_strategy_operation_used_total{strategy,provider,operation}` | No                             | L5  |
| Per-node request counts and durations       | `vouch_client_operation_requests_total{provider,operation,result}` | Per route, per URL errors only | L5  |
| Node active/inactive state                  | `vouch_multi_connections`, `vouch_multi_connection_state`          | Score gauge                    |     |
| Multi-instance activity                     | `vouch_multiinstance_active{operation}`, `..._checks_total`        | n/a                            |     |
| Readiness                                   | `vouch_ready` gauge                                                | No                             | L12 |
| Block receipt delay per slot                | `vouch_block_receipt_delay_seconds`                                | No                             |     |
| Tracing                                     | OpenTelemetry over gRPC with optional mTLS                         | No                             |     |
| Health endpoint                             | None                                                               | None                           | L12 |

## 9. Multi-instance operation

The Vouch model for running N instances on the same keys is:

1. Every instance connects to the same Dirk cluster and the same or different beacon nodes.
2. Every instance runs the non-slashable work (aggregation, sync committee, registrations, preparations) regardless.
3. For attestations and proposals, `static-delay` makes instances passive by default; an instance becomes active when it finds no evidence of another instance's work in the beacon node and stays active until a failure.
4. Dirk's rules guarantee that at most one attestation per target epoch and one proposal per slot can be composed for a key, regardless of how many instances request signatures. A denial is the signal that another instance won.

Strengths: no coordination infrastructure, no shared database, tolerant to network partitions between Vouch instances, and the safety invariant is enforced at the signer where the keys are. Weaknesses: takeover costs at least 4 seconds plus the configured delay in attestation timing; correctness of the passive check depends on beacon nodes subscribing to all subnets; two passive instances can race and one will simply be denied; and there is no operator visibility into which instance is "leader" beyond metrics on each instance.

## 10. Features Lodestar has that Vouch lacks

Local slashing protection with EIP-3076 import and export, doppelganger protection, the keymanager API with live key import and removal, per-key configuration through a settings file or API, `--distributed` DVT aggregator selection, Gloas support including PTC duties and in-protocol builders, and a configuration file plus rc-file mechanism with generated CLI documentation.

## 11. Takeaways for the Lodestar HA product

Worth adopting:

1. Per-operation node sets and selection styles, including `best` scoring, `majority` with a configurable threshold that fails closed, and `first` (`L4`, `L13`).
2. A submitter that publishes to every node and returns on the first success, with client-specific benign error handling (`L3`).
3. Continuous health probing with demotion and re-admission of nodes, instead of cold fallback (`L1`, `L5`).
4. Structured signing requests so the signer can enforce rules, batched per account (`L6`).
5. Passive takeover as a coordination-free HA mode, generalised so the passive check uses more than the attestation pool.
6. Strategy and per-node metrics, a readiness gauge, and tracing (`L5`, `L12`).
7. Fast-track on head events with configurable delays, and preparation of RANDAO and duties off the critical path.

Gaps Vouch leaves open:

- Safety in multi-instance mode depends entirely on the signer. A Lodestar product that works with Web3Signer or local keys needs its own shared or replicated slashing protection (`L8`).
- No doppelganger detection, no slashing event detection, no health endpoint.
- The relay service is a single point of failure per instance for MEV.
- Event stream failover is forward-from-primary with a detectable stall case.
