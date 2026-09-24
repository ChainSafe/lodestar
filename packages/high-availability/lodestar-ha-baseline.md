# Lodestar Validator Client: High-Availability Baseline

This document records what the current Lodestar validator client (VC) does and does not do for redundancy and high availability (HA). It is the reference point for the competitor analyses in this folder ([Vouch](./vouch-feature-analysis.md), [Vero](./vero-feature-analysis.md), [Dirk](./dirk-feature-analysis.md)) and for the [HA product requirements](./ha-validator-prd.md). Gaps are numbered `L1`..`L16` so the other documents can cite them.

Snapshot: branch `mkeil/high-availability-design`, HEAD `57bd7a28a0`, read on 2026-09-24. All paths are relative to the repository root. Line numbers refer to that working tree.

## Summary

Lodestar's VC is a single-process, single-instance design. It accepts several beacon node URLs but treats them as a primary with cold fallbacks, not as a redundant set. It signs locally or through one Web3Signer-compatible URL per key, with no signer failover. Slashing protection is a local LevelDB that only one process may own. There is no coordination protocol between VC instances, no shared slashing state, and no HA guidance in the documentation. The pieces that do help HA are the score-based fallback client, the optional doppelganger check, the epoch re-subscription of subnets, the Gloas stateless-payload preference when several nodes are configured, and the ability to inject a custom API client when the VC is used as a library.

## 1. Beacon node layer

### 1.1 Multi-node configuration

`--beaconNodes` accepts a comma-separated list. Every VC request goes through one `HttpClient` that holds the ordered list (`packages/cli/src/cmds/validator/options.ts:201-210`, `packages/validator/src/validator.ts:195-210`). Per-URL options such as timeouts, headers and bearer tokens exist on the programmatic `UrlInit` type but have no CLI surface (`packages/api/src/utils/client/httpClient.ts:72-76`).

### 1.2 Selection and failover algorithm

The client is primary-with-fallbacks and score-gated (`packages/api/src/utils/client/httpClient.ts:176-277`):

- Every URL starts at the maximum score of 10. Success adds 1, any failure subtracts 2.
- A request is sent to URLs in order, and the inner loop stops as soon as it has sent to a URL whose score is at the maximum. While the primary is healthy, only the primary is queried.
- Once the primary's score drops below the maximum, the same request is raced against the primary and the next URL(s) until a fully healthy URL is reached. The first successful response wins.
- If every raced URL fails, the outer loop advances to the next unqueried URL.
- Any thrown error or any non-2xx response counts as a failure. A 503 from a syncing node, a 400 and a 404 are all treated the same.

Consequences for HA:

- **Cold failover latency equals the request timeout.** The first failure of a healthy primary is only sent to the primary, and the client waits for the timeout (default one slot, `--http.requestTimeout`, `packages/validator/src/validator.ts:203-207`) before trying the fallback. An attestation due in that slot is likely missed.
- **Recovery is slow by design.** A primary needs 10 consecutive successes after a single failure to return to primary-only mode.
- **Fallback health is unknown until needed.** Fallback scores only change when a fallback is queried, so a dead fallback is discovered during the failover itself.
- Retries are disabled (`DEFAULT_RETRIES = 0`) and the VC never enables them.

### 1.3 Submissions

Publishing uses the same request path, so attestations, aggregates, blocks, envelopes, sync messages and registrations go to one node while the primary is healthy. There is no broadcast-to-all mode and no cross-checking of duty or attestation data between nodes. The first successful response is used as-is (`packages/validator/src/services/attestation.ts:185`, `packages/validator/src/services/block.ts:280-292`).

### 1.4 Event stream

The SSE client subscribes once to `head` (and `execution_payload_available` for Gloas) using `httpClient.baseUrl`, which is always the first URL (`packages/api/src/beacon/client/index.ts:39`, `packages/api/src/utils/client/httpClient.ts:99-101`). The stream never fails over. When the primary is down, attestation and sync duties fall back to the fixed slot deadlines, duty reorg detection stops, and the PTC early-submit path never fires (`packages/validator/src/services/chainHeaderTracker.ts:45-125`, `packages/api/src/beacon/client/events.ts:50-66`).

### 1.5 Health tracking

`SyncingStatusTracker` polls `/eth/v1/node/syncing` every slot and sets `vc_beacon_health` (`packages/validator/src/services/syncingStatusTracker.ts:52-87`). Because the poll goes through the fallback-capable client, the reported status is whichever node answered. A dead primary with a healthy fallback reads as "Node is synced". The only primary-specific signals are an epoch-level warning when the primary's score reaches zero (`packages/validator/src/validator.ts:155-168`) and the `vc_rest_api_client_urls_score` gauge.

### 1.6 Behaviours that help node swapping

- Subnet subscriptions are re-sent every epoch explicitly so a swapped or restarted node picks them up quickly (`packages/validator/src/services/attestationDuties.ts:203-207`).
- With more than one beacon node configured, the Gloas block flow prefers stateless payload publishing so the envelope can be published through any node (`packages/validator/src/validator.ts:273-275`).
- Startup asserts the beacon node's spec, genesis time and genesis validators root against the VC's persisted values, preventing a VC database from being pointed at another network (`packages/validator/src/validator.ts:371-373`, `:473-502`).

### 1.7 Authentication

HTTP Basic credentials embedded in the URL are supported. Bearer tokens exist in the type but have no flag. There is no mTLS or client-certificate option toward beacon nodes.

## 2. Signer layer

### 2.1 Signer model

Each pubkey maps to exactly one signer, either `Local` (blst secret key) or `Remote` (one URL) (`packages/validator/src/services/validatorStore.ts:65-79`, `:1139-1181`).

### 2.2 Local keystores

EIP-2335 keystores are decrypted in a worker thread pool and cached into a single re-encrypted file for fast restarts (`packages/cli/src/cmds/validator/keymanager/keystoreCache.ts`). Every loaded keystore is protected by a lockfile so a second process on the same host fails to start unless `--force` is passed (`packages/cli/src/util/lockfile.ts`). The lock is process-local and offers no cross-host protection.

### 2.3 Remote signer

- Protocol: Web3Signer-compatible remote signing API, JSON only (`packages/validator/src/util/externalSignerClient.ts:133-194`). All current signing types through Gloas are implemented.
- Transport: a bare `fetch` with no timeout, no retry, no authentication header and no mTLS configuration (`externalSignerClient.ts:170-177`). A slow signer can hold a duty past its deadline.
- `upcheck` is implemented but never called.
- Multiple signer URLs are supported only in `--externalSigner.fetch` mode. Each pubkey is bound to the first URL that reports it. Startup fails if any configured signer is unreachable (`packages/cli/src/cmds/validator/signers/index.ts:199-239`).
- **Signer failover is not supported.** If the bound signer errors, the duty fails for that key. There is no secondary URL, health-based re-binding or retry.
- **Threshold or distributed signing is not implemented.** DVT is supported only indirectly via `--distributed`, where middleware such as Obol Charon occupies the beacon node position (`packages/cli/src/cmds/validator/options.ts:444-447`).

### 2.4 Distributed mode

`--distributed` disables slot skipping in the clock (middleware may hold requests until a threshold is met) and exchanges partial aggregator selection proofs through `beacon_committee_selections` and `sync_committee_selections` (`packages/validator/src/services/attestationDuties.ts:460-511`, `packages/validator/src/services/syncCommitteeDuties.ts:358-419`). The VC itself performs no threshold cryptography.

## 3. Slashing protection

- Always on, local LevelDB under `validator-db` (`packages/cli/src/cmds/validator/handler.ts:73-76`). Blocks are keyed by pubkey and slot, attestations by pubkey and target epoch, with min-max surround tracking (`packages/validator/src/slashingProtection/`).
- Enforced in `ValidatorStore` before any signature request, for both local and remote signers (`packages/validator/src/services/validatorStore.ts:689-694`, `:775-784`). A Web3Signer's own slashing database is independent and invisible to the VC.
- Check-then-insert is not transactional; the code comments state it is safe only because a single process owns the database (`packages/validator/src/slashingProtection/attestation/index.ts:146-154`).
- EIP-3076 v5 import and export via CLI and via the keymanager API (`packages/cli/src/cmds/validator/slashingProtection/`, `packages/cli/src/cmds/validator/keymanager/impl.ts:137-145`, `:241-266`).
- No shared, remote or replicated slashing database. Two VC instances must never share `validator-db`.

## 4. Safety mechanisms

### 4.1 Doppelganger protection

Opt-in via `--doppelgangerProtection`, default off (`packages/cli/src/cmds/validator/options.ts:361-366`). At 75% of the last slot of each epoch the VC polls `/eth/v1/validator/liveness/{epoch}` for the previous and current epoch. A key registered in epoch N becomes safe at the end of epoch N+2, so a start costs roughly two epochs of duties. The restart shortcut skips detection when the local slashing database shows the key attested in the previous epoch. On detection the process sends itself SIGINT (`packages/validator/src/services/doppelgangerService.ts`, `packages/cli/src/cmds/validator/handler.ts:83-87`). Sync committee duties are not filtered by doppelganger status.

### 4.2 Slashing detection and halting

The VC does not watch the chain for slashings of its own keys and does not halt on a slashing protection violation. A violation fails that one signing and the duty is skipped.

### 4.3 Sign-time sanity checks

Blocks with a future slot, attestations with a future target epoch, and duty/data mismatches are refused at signing (`packages/validator/src/services/validatorStore.ts:669-672`, `:760-765`, `:1184-1212`). With `executiononly` a builder-sourced payload is rejected (`packages/validator/src/services/block.ts:450-467`).

## 5. Duty timing relevant to HA

- Attestations and sync messages wait for a `head` event for the duty slot or the fixed slot deadline, whichever is first (`packages/validator/src/services/attestation.ts:78-85`). Losing the event stream degrades timing rather than correctness.
- Attestation and PTC duties track dependent roots and refetch on head-event reorgs. Sync committee duties do not track dependent roots.
- Block duties note a race between the epoch poll and head-event refetch and rely on the same node serving both calls (`packages/validator/src/services/blockDuties.ts:326-331`), an assumption that fallback routing weakens.
- Slot tasks that overrun cause the next slot's task to be skipped unless `--distributed` or `--clock.skipSlots false` is set.

## 6. Block production relevant to HA

- Pre-Gloas: `produceBlockV3` with builder selection strategies (`default`, `maxprofit`, `builderalways`, `executionalways`, `executiononly`) and a boost factor. The VC never talks to relays directly; the beacon node does.
- Gloas: `produceBlockV4` with in-protocol builders, per-key builder configuration, and a stateless or stateful payload flow. The stateful flow requires the same node that produced the block, which is the one place the VC implicitly depends on per-duty node pinning (`packages/validator/src/services/block.ts:170-389`).
- Validator registrations and `prepare_beacon_proposer` are sent every epoch in chunks of 512.

## 7. Validator and account management

- Keymanager API with the standard keystore, remote key, fee recipient, graffiti, gas limit and voluntary exit routes, plus Lodestar-specific builder configuration routes (`packages/api/src/keymanager/routes.ts`). Keys can be added and removed live.
- `--proposerSettingsFile` for per-key configuration, mutually exclusive with persisted keymanager settings.
- External signer key sync every `--externalSigner.fetchInterval` adds and removes remote keys live.

## 8. Observability

- Prometheus metrics behind `--metrics` including `vc_beacon_health`, `vc_rest_api_client_urls_score`, `vc_rest_api_client_request_to_fallbacks_total`, `vc_remote_sign_errors_total`, `vc_slashing_protection_*_errors_total` and doppelganger status (`packages/validator/src/metrics.ts`).
- Remote monitoring endpoint in beaconcha.in style.
- No `/health` or readiness endpoint. The metrics server is the only probe surface.
- No distributed tracing.

## 9. Multi-instance operation today

Guards that exist: same-host keystore lockfiles, opt-in doppelganger protection, and the import warning about reusing keystores in another client.

Missing: leader election or active-passive coordination, shared or replicated slashing state, VC-to-VC communication, heartbeats, automatic hand-off, and any documentation about running redundant instances. The doppelganger and slashing protection design pages under `docs/pages/contribution/advanced-topics/` are one-line stubs.

## 10. Extension points

- `@lodestar/validator` is consumable as a library. `Validator.initializeFromBeaconNode` accepts a custom `ApiClient`, so an embedder can supply its own multi-node or fan-out client without changing the duty services (`packages/validator/src/validator.ts:62-69`, `:195-213`).
- `ValidatorStore` centralises signing and slashing protection behind one interface, which is the natural seam for a different signer backend or a shared protection store.
- The `Signer` union (`Local | Remote`) is the seam for new signer kinds.

## Gap list

| ID  | Gap                                                                                                         | Evidence                                                      |
| --- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| L1  | Cold failover latency equals the request timeout; primary-only querying while healthy; slow recovery        | `httpClient.ts:176-277`                                       |
| L2  | Event stream pinned to the first URL and never fails over                                                   | `beacon/client/index.ts:39`, `httpClient.ts:99-101`           |
| L3  | No fan-out of submissions to several beacon nodes                                                           | `httpClient.ts:221-224`                                       |
| L4  | No cross-checking or majority agreement of attestation or duty data across nodes                            | same                                                          |
| L5  | Health reflects whichever node answered; no per-node probing; no head-slot or sync-distance based selection | `syncingStatusTracker.ts:52-87`                               |
| L6  | Remote signer: one URL per key, no failover, no timeout, no retry, no auth or mTLS                          | `externalSignerClient.ts:170-177`, `signers/index.ts:199-239` |
| L7  | No threshold or distributed signing inside the VC                                                           | `validatorStore.ts:65-79`                                     |
| L8  | Slashing database is local only and non-transactional; no shared or replicated store                        | `slashingProtection/attestation/index.ts:146-154`             |
| L9  | No coordination between VC instances (leader election, lease, heartbeat, hand-off)                          | absence in `packages/validator/src`                           |
| L10 | Doppelganger protection opt-in, costs about two epochs, terminates the process                              | `doppelgangerService.ts`                                      |
| L11 | No detection of, or halt on, slashing of the VC's own validators                                            | absence in `packages/validator/src`                           |
| L12 | No health or readiness endpoint                                                                             | `packages/api/src/keymanager/server/index.ts:13-19`           |
| L13 | No per-duty node routing or pinning, other than the implicit Gloas stateful payload constraint              | `block.ts:170-389`                                            |
| L14 | No per-URL timeouts, auth or mTLS via CLI for beacon node connections                                       | `options.ts:201-210`                                          |
| L15 | No documentation for HA or multi-instance operation                                                         | `docs/pages/contribution/advanced-topics/*.md` stubs          |
| L16 | Sync committee duties skip doppelganger filtering and have no reorg handling                                | `syncCommitteeDuties.ts:270-273`, `:290-311`                  |
