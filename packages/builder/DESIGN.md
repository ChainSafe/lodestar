# Lodestar Builder: Design

Status: implemented (phases 1 and 2), verified end to end on a kurtosis devnet

This document describes how `@lodestar/builder` evolves from the current startup skeleton (identity resolution, readiness gating, signer, status tracker) into a builder that submits bids and reveals payloads built by local execution clients.

## 1. Goal and scope

A builder that, for every slot:

1. builds an execution payload on one or more local execution clients,
2. submits a signed `ExecutionPayloadBid` for it,
3. reveals the signed `ExecutionPayloadEnvelope` (plus blobs) if the proposer commits to the bid.

Out of scope: MEV searching, external block builders, relays, builder deposits and exits.

## 2. Protocol constraints

These are fixed by the consensus spec and by the gossip validation rules the network applies. The design is built around them.

- **A bid commits to a fully built payload.** `blockHash`, `blobKzgCommitments`, `executionRequestsRoot` and `gasLimit` are part of the bid, so the EL build must be finished before bidding. The envelope only adds `beaconBlockRoot`, which is known once the proposer's block is seen. There is no `state_root` in the envelope, so the reveal is assembly plus signature.
- **Parent binding.** `parentBlockRoot` is the head block root, `parentBlockHash` is either the head's own payload hash (FULL variant) or the head's parent's payload hash (EMPTY variant). Receiving nodes only forward a bid for the variant `should_build_on_full(head, slot)` selects on their view (FULL iff the payload is available and timely).
- **One bid per `(slot, parentBlockHash, parentBlockRoot, builder)`.** A second bid from the same builder on the same tuple is ignored. Bids cannot be updated. Nodes also only forward a bid if it exceeds the best bid they have seen by a minimum increment.
- **Proposer preferences gate bidding.** A bid is ignored unless the proposer's `SignedProposerPreferences` for the slot is known, `bid.feeRecipient` equals the preferences fee recipient, and `bid.gasLimit` is compatible with `targetGasLimit`. `executionPayment` must be zero.
- **Economics.** `bid.value` is paid from the builder's consensus balance to `bid.feeRecipient` as a pending payment, released at epoch end only if the PTC weight reaches quorum. The builder must satisfy `balance - (MIN_DEPOSIT_AMOUNT + pendingWithdrawals) >= value`. The payload coinbase is unconstrained, so builder revenue is EL tips and MEV sent to `executionFeeRecipient`.
- **Timing (12s slot).** Attestations at 3s, envelope due at 6s (`PAYLOAD_DUE_BPS`), PTC at 9s (`PAYLOAD_ATTESTATION_DUE_BPS`). Bids are accepted for the current or next slot and the proposer selects at slot start, so bids for slot S are made during S-1 and the reveal for S happens in the first seconds of S.

## 3. Architecture

### Roles

| Component           | Responsibility                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Beacon node         | Unchanged role. Syncs its EL (`newPayload`, `forkchoiceUpdated`), emits `payload_attributes` and other events, validates and gossips bids and envelopes, derives data column sidecars on publish. |
| Execution client(s) | Build payloads. The builder talks to them directly over the Engine API. Each EL is kept in sync by a beacon node, so the builder never drives EL sync.                                            |
| Builder client      | Key, timing, pricing, bookkeeping. Shaped like the validator client: duties derived from the clock and beacon node events, one-shot decisions, owns the payload material it has bid on.           |

### Key decisions

**The builder speaks Engine API directly, the beacon node keeps the EL synced.** Everything needed to keep an EL synced already happens in the beacon node. The builder only adds the build half of the Engine API: `forkchoiceUpdated` with payload attributes to obtain a `payloadId`, and `getPayload`. This keeps the beacon node surface minimal, gives the builder full control over build timing and polling, makes multiple local ELs just multiple engine endpoints, and keeps the builder portable across beacon node and EL implementations.

**Payload attributes come from the beacon node.** `prevRandao` and `withdrawals` depend on the variant specific parent state advanced to the target slot, which only the beacon node has. The existing `payload_attributes` SSE event already provides them, including `targetGasLimit` from the proposer preferences pool.

**Always broadcast.** Bids cost nothing unless they win, bidding is one-shot, and the local view of competing bids is partial and late. The builder prices from its own economics and broadcasts unconditionally. Competing bids are never a decision input. The beacon node side mirrors this: API-submitted bids are flood published without the gossip validation gate, including bids that do not build on the beacon node's own head view (see section 11).

**The builder owns the payload material it bids on.** At `getPayload` time the builder keeps payload, execution requests, blobs and proofs keyed by `blockHash`. The reveal uses the stateless `publishExecutionPayloadEnvelope` flow (envelope with blobs and proofs). This works through any beacon node, survives beacon node restarts, and decouples where a payload was built from where it is published.

**Reveal on `block`, not `block_gossip`.** The `block` event fires after `on_block`, so the block passed the full state transition including `process_execution_payload_bid`. The beacon node waits for block import before publishing an envelope anyway, and peers require the block to be seen. The cost is the local import time, negligible against the 6s envelope deadline.

## 4. Inputs and outputs

All existing beacon node APIs. Phase 1 requires no beacon node code changes, only `--emitPayloadAttributes`.

| Need                        | Source                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build inputs for slot S     | `payload_attributes` event: `parentBlockRoot`, `parentBlockHash`, `prevRandao`, `withdrawals`, `timestamp`, `parentBeaconBlockRoot`, `slotNumber`, `targetGasLimit` |
| `bid.feeRecipient`          | `proposer_preferences` event (slot to preferences map). Not `suggestedFeeRecipient` from the attributes event, which is the local proposer's address or zero        |
| EL coinbase                 | `executionFeeRecipient` (existing CLI flag)                                                                                                                         |
| Coverable balance           | `getStateBuilders` balance, minus `MIN_DEPOSIT_AMOUNT`, minus unsettled won bids tracked by the ledger                                                              |
| Block committing to our bid | `block` event, then `getBlockV2` to read `body.signedExecutionPayloadBid`                                                                                           |
| Submit bid                  | `publishExecutionPayloadBid`                                                                                                                                        |
| Reveal                      | `publishExecutionPayloadEnvelope` with `SignedExecutionPayloadEnvelopeContents` (envelope, blobs, KZG proofs)                                                       |
| Build                       | Engine API `forkchoiceUpdated` with attributes, `getPayload`                                                                                                        |

## 5. Slot timeline

Target slot S. Times are relative to the start of slot S-1 on a 12s slot.

```
slot S-1                                                              slot S
0s          3s        6s          8s             ~10.5s       12s|0s   ≤~1s          6s       9s
│ block S-1  │ attest  │ envelope  │ payload_     │ bid         │ block S │ reveal      │ env    │ PTC
│ seen       │ due     │ S-1 due   │ attributes   │ deadline    │ imported│             │ due    │
▼            ▼         ▼           ▼              ▼             ▼         ▼             ▼        ▼
                                   fcU(attrs)     getPayload    block     sign +
                                   on every EL    on every EL   has our   publish
                                                  pick max      bid?      envelope
                                                  price, sign,            + blobs
                                                  broadcast
```

The per-slot `payload_attributes` emission at 8s alone leaves roughly 2.5s of build time, and the variant it selects is the correct fallback: the envelope is due at 6s, so if it has not arrived by 8s the event already points at the EMPTY parent. The beacon node additionally emits event-driven per variant (see section 11) so builds start as early as possible and both variants are covered. The builder deduplicates emissions by `(slot, parentBlockHash)`.

## 6. Per-slot flow

### SlotBidder(S)

```
on payload_attributes for proposalSlot S:
  record attrs keyed by (S, parentBlockHash)
  for each EL: fcU({head: parentBlockHash, safe, finalized}, attrs with suggestedFeeRecipient = executionFeeRecipient)
    SYNCING or null payloadId: parent payload not imported yet, retry until deadline

at deadline (bidding.deadlineBps into slot S-1):
  for each variant with a payloadId: getPayload on every EL in parallel with a short timeout
  pick the payload with the highest executionPayloadValue per variant
  value = policy(payloadValue, coverable)
  skip variant if value is null (cannot cover, below floor)
  store payload material by blockHash
  build bid, sign, publishExecutionPayloadBid
  record submitted tuple in ledger

on head change for S-1 (reorg): drop pending handles, wait for new payload_attributes

close at S+1, prune store at S+2
```

Bid construction:

| Field                   | Value                              |
| ----------------------- | ---------------------------------- |
| `parentBlockHash`       | `payload.parentHash`               |
| `parentBlockRoot`       | `attrs.parentBlockRoot`            |
| `blockHash`             | `payload.blockHash`                |
| `prevRandao`            | `payload.prevRandao`               |
| `feeRecipient`          | proposer preferences fee recipient |
| `gasLimit`              | `payload.gasLimit`                 |
| `builderIndex`          | resolved builder index             |
| `slot`                  | S                                  |
| `value`                 | policy output                      |
| `executionPayment`      | 0                                  |
| `blobKzgCommitments`    | `blobsBundle.commitments`          |
| `executionRequestsRoot` | `hashTreeRoot(executionRequests)`  |

### Revealer

```
on block event for slot S:
  fetch block, read body.signedExecutionPayloadBid.message
  ignore unless builderIndex is ours
  ignore unless blockHash is in the payload store (log, nobody can forge our signature)
  skip if past reveal.cutoffBps
  envelope = {payload, executionRequests, builderIndex, beaconBlockRoot: blockRoot, parentBeaconBlockRoot: attrs.parentBlockRoot}
  sign, publishExecutionPayloadEnvelope with blobs and proofs
  record win and reveal in ledger
```

Reveal for every distinct block root that commits to the bid (equivocating proposer). The payload is the same and the envelope is bound to the block root.

## 7. Pricing

The builder's margin on a won slot is EL revenue to the coinbase minus `value`.

```
value = max(minValue, floor(payloadValueGwei * shareBps / 10_000) - fixedCostGwei, 0)
value = min(value, maxValue)
skip if value > coverable
```

`coverable = balance - MIN_DEPOSIT_AMOUNT - unsettled won bids`. Profitability is controlled through `shareBps` and `fixedCostGwei`, there is no separate profit floor. `BidPolicy` is an interface so other strategies can be plugged in. The baseline never looks at competing bids.

## 8. Invariants

Enforced locally by the ledger, independent of what the protocol slashes:

- Never sign a bid for a `blockHash` not in the payload store. A won bid that cannot be revealed damages reputation and the proposer.
- Never submit the same `(slot, parentBlockHash, parentBlockRoot)` tuple twice.
- Never sign two different envelopes for the same `beaconBlockRoot`.
- Stop bidding when the builder status is `exited` or the balance drops below `minOperatingBalance`.

Coverable balance is an estimate. `publishExecutionPayloadBid` returning `BID_TOO_HIGH` is the safety net.

## 9. Components

```
src/
  builder.ts                      wiring and lifecycle (exists, extended)
  services/
    builderSigner.ts              exists: signExecutionPayloadBid, signExecutionPayloadEnvelope
    builderStatusTracker.ts       exists: status and balance
    chainEvents.ts                SSE subscription to a typed event emitter (head, block, payloadAttributes, proposerPreferences)
    proposerPreferencesTracker.ts slot to preferences map
    payloadSource.ts              interface plus EnginePayloadSource wrapping ExecutionEngineHttp
    payloadStore.ts               blockHash to {payload, executionRequests, blobs, proofs, slot, attrs}, pruned by slot
    bidPolicy.ts                  interface plus the default proportional policy
    slotBidder.ts                 per-slot state machine
    revealer.ts                   block event to envelope publish
    ledger.ts                     submitted tuples, wins, reveals, unsettled payments
```

`ExecutionEngineHttp` lives in `@lodestar/beacon-node`, which the CLI already depends on. Lifting it into its own package is a follow-up.

## 10. Configuration and metrics

CLI additions: `--execution.urls` (one payload source per url), `--execution.timeout`, `--execution.retries`, `--execution.retryDelay`, `--jwtSecret`, `--jwtId`, `--bidding.shareBps`, `--bidding.fixedCostGwei`, `--bidding.minValueGwei`, `--bidding.maxValueGwei`, `--bidding.deadlineBps`, `--bidding.prepareRetryMs`, `--bidding.getPayloadTimeoutMs`, `--bidding.minOperatingBalanceGwei`, `--reveal.cutoffBps`. `--executionFeeRecipient` is the EL coinbase.

Metrics: `bc_builder_bids_submitted_total{result}`, `bc_builder_bids_won_total`, `bc_builder_bid_value_gwei`, `bc_builder_payload_value_gwei{source}`, `bc_builder_bid_submit_time_seconds`, `bc_builder_payload_prepare_time_seconds{source}`, `bc_builder_payload_prepare_failed_total{source}`, `bc_builder_get_payload_time_seconds{source}`, `bc_builder_reveals_total{result}`, `bc_builder_reveal_time_seconds`.

## 11. Beacon node follow-ups

All of these are implemented alongside the builder. They improve any external builder, not only this one.

- **Bid publishing.** `publishExecutionPayloadBid` currently runs the full gossip validation (`validateApiExecutionPayloadBid`) and refuses to publish on any IGNORE. Those rules (head compatibility, first bid per tuple, increment over the local best, proposer preferences seen, balance coverage, known parent payload) exist to limit forwarding of other peers' messages. They must not gate the operator's own builder:
  - Publish unconditionally. In particular, allow bids whose parent does not match the beacon node's head view. The builder may have a different view or bid on several branches, and peers apply their own rules.
  - Flood publish to every subscribed peer above the publish threshold, not only mesh peers. The proposer's node may not be in our mesh or may be on a different head. Lodestar disables gossipsub's global flood publish by default for bandwidth reasons, and gossipsub has no per-message override, so bids are flood published per topic (`gossipTopicFloodPublish`) by overriding the publish peer selection for that topic, independent of `--network.disableFloodPublish`. Bids are tiny; envelopes are megabytes and are not flooded.
  - Insert into `executionPayloadBidPool` only when full validation passes, so a local proposer never commits to an invalid bid. Return the validation outcome as informational, not as an error.
  - Keep only cheap self-contained REJECT checks (signature, builder index and status, blob count, zero `executionPayment`) as a peer score guard, since our node is the origin and would be penalized by every peer for an invalid message. Whether to keep even these is a judgment call, see section 14.
- Post-gloas `payload_attributes`: emit event-driven per variant (on head block import for the EMPTY parent, on head envelope import for the FULL parent) in addition to the 8s tick. Each emission is self-describing via `parent_block_hash`. This gives up to 10s of build time and covers view flips after 8s.
- Add `safe_block_hash` and `finalized_block_hash` to the gloas `payload_attributes` event. `prepareNextSlot` already computes both for its own `forkchoiceUpdated`.
- Add the committed bid's `builder_index` and `block_hash` to the `block` event so the reveal decision needs no block fetch.

The last three items extend standard events beyond the beacon-APIs spec. The builder treats the extra fields as optional so it keeps working against other beacon nodes, and section 16 lists the spec changes that would make them standard.

## 12. Phases

1. Done: `payload_attributes` driven builds, fixed-share policy, reveal via stateless publish, bid publishing change from section 11.
2. Done: remaining beacon node follow-ups from section 11, dual-variant bidding, ledger and metrics, multiple ELs with max-value selection.
3. Open: the parent-of-head variant for proposer-boost reorg slots, reveal redundancy across beacon nodes.

## 13. Alternatives considered

- **Beacon node mediated builds** (`prepare` and `get` routes proxying the Engine API). Single writer to the EL and no JWT in the builder, but adds beacon node routes and state, ties the builder to Lodestar, and makes multiple ELs require multiple beacon nodes in the build path. Kept reachable as an alternative `PayloadSource`.
- **Builder embedded in the beacon node, client as signer only.** Lowest latency and no API, but puts policy and key handling in the beacon node and abandons the validator-client-shaped separation the package already commits to.
- **Competitor-aware pricing** (skip or shade against the best bid seen locally). Can only lose slots under one-shot bidding with a partial view. Possible as a policy plugin, not the baseline.
- **Beacon node caches payloads, stateful reveal** (as self-build does today). Fewer bytes over HTTP but ties the reveal to one beacon node's cache.

## 14. End to end verification

Verified on a two node minimal preset kurtosis devnet (gloas at genesis, 6s slots, geth) with the builder running as a host process against node 1, config in `~/debug/kurtosis/config/builder-p2p-bids.yaml`. The builder must be onboarded with an EIP-8282 deposit first, `builder_count` only funds the key. Observed: two bids per slot (empty and full parent variants), the full variant selected by node 2's proposers (`Selected builder block reason=builder_preferred`), envelopes revealed about 1s into the slot including blobs and data columns, `head_v2` flipping empty to full every slot, 100% of slots won while the builder was the only bidder, and the builder balance decreasing by the bid value per won slot as payments settle.

## 15. Open questions

- **Two writers to EL fork choice.** The beacon node issues `forkchoiceUpdated` for sync, the builder for builds. Per the Engine API a build is identified by `payloadId` and a later `forkchoiceUpdated` without attributes does not cancel it, but this needs verification per EL on a devnet.
- **EMPTY-variant builds move the EL head back one payload** until the next `forkchoiceUpdated`. This is inherent to dual-variant building in ePBS and happens with self-build today. Mitigation: issue the FULL build as soon as the envelope arrives and restore the head after `getPayload`.
- **Safe and finalized hashes against other beacon nodes.** Lodestar emits them in the `payload_attributes` event (section 16). When they are absent the builder currently passes zero hashes, which depends on EL behavior. The portable fallback is what buildoor does: resolve the justified and finalized roots from `finality_checkpoints` to the bid `parent_block_hash` of those blocks (an ancestor the EL is guaranteed to have, one payload behind the true finalized payload when it was delivered), cached per head. Never point finalized at the head hash.
- **Reveal cutoff default.** `PAYLOAD_ATTESTATION_DUE_BPS` is the natural default, a late envelope can still be imported but will not count as timely.
- **Which checks remain on API bid publishing.** The operator's builder is trusted, so the simplest rule is none. The argument for keeping self-contained REJECT checks is peer score: a builder bug that signs invalid bids would get our beacon node penalized by every peer it floods. The randao check is branch dependent and should be evaluated against the bid's own parent state if kept, never against the head.

## 16. Proposed beacon-APIs changes

The beacon node side of this design relies on information the beacon-APIs spec does not expose today. Lodestar ships it as optional extensions of standard events; the following changes would make them standard. buildoor, which has the same architecture (consumes `payload_attributes`, calls `engine_forkchoiceUpdated` itself), works around the same gaps on the builder side.

### `payload_attributes`: forkchoice state

Add optional `safe_block_hash` and `finalized_block_hash` next to `parent_block_hash` inside `data`, from `gloas` onwards. Lodestar currently emits them at the top level next to `version` and `data` and will move them to match the spec.

> `safe_block_hash`, `finalized_block_hash`: the execution block hashes the node would pass as `safeBlockHash` and `finalizedBlockHash` in `engine_forkchoiceUpdated` when building on `parent_block_hash`.

Rationale: the event exists so an external process can call `engine_forkchoiceUpdated`, but that call requires a full `ForkchoiceStateV1` and the event only provides the head. From `gloas` onwards the justified and finalized execution hashes depend on whether those blocks' payloads were delivered, which is not observable through the beacon API, so consumers either pass zero hashes (EL defined behavior) or approximate. An external builder is also a second `forkchoiceUpdated` writer on the same execution client as the beacon node; passing different safe and finalized hashes than the node makes the execution client's view flip between the two callers.

### `payload_attributes`: emission semantics post-gloas

The spec only says the frequency may depend on node configuration. Proposed text:

> From `gloas` onwards a block at `proposal_slot` may build on either the parent's delivered payload (full) or the parent's own execution parent (empty), and which one the proposer uses is decided at proposal time. Nodes SHOULD emit this event once per distinct `(parent_block_root, parent_block_hash)` as soon as that parent becomes buildable: the empty variant when the parent block is imported, the full variant when the parent's payload is imported. Nodes MAY emit the same variant again, for example at a fixed point in the slot. Consumers MUST deduplicate by `(proposal_slot, parent_block_root, parent_block_hash)`.

This is what Lodestar does (section 11). Without it builders have to synthesize the empty variant themselves, which buildoor does by swapping the parent hash and reusing the parent slot's withdrawals; the full variant cannot be synthesized since its withdrawals need the beacon state.

### `block`: the committed bid

Add optional `builder_index` and `block_hash` from `gloas` onwards, with the same names and encoding as the existing `execution_payload` event (`builder_index` is `18446744073709551615` for self-build).

> `builder_index`, `block_hash`: the builder index and execution block hash of the `ExecutionPayloadBid` the block commits to.

Rationale: a builder has to reveal within `PAYLOAD_DUE_BPS` of seeing the block, and the only way to learn whether a block commits to its bid today is a block fetch per imported block. The `execution_payload` event already exposes this pair for envelopes.

### Proposer preferences query (undecided)

Not part of the proposal for now, noted as a possible follow-up. A route to read pooled proposer preferences, e.g. `GET /eth/v1/beacon/pool/proposer_preferences?slot=`, would let a builder that starts mid-epoch bid on the next slots right away. Today builders learn `fee_recipient` and `target_gas_limit` only from the `proposer_preferences` event and miss the slots whose preferences were gossiped before they subscribed. buildoor falls back to `suggested_fee_recipient` from the attributes, which Lodestar emits as the zero address for non-local proposers. The SSE-only approach is good enough for now: the gap is limited to the first slots after startup and preferences for later slots arrive through the stream.
