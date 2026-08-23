# Lodestar Builder: Beacon Node Mediated Builds (alternative design)

Status: not implemented, documented for reference

This is the first design considered for `@lodestar/builder`, before settling on the one in [DESIGN.md](./DESIGN.md). The difference is where payload building happens: here the builder never opens an Engine API connection and asks the beacon node to build payloads on its behalf. Everything else (bidding, pricing, reveal, ledger) is the same as in the implemented design and is only summarized.

## 1. Roles

| Component           | Responsibility                                                                                                                                                                                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Beacon node         | Chain context, execution gateway and gossip gateway. Keeps its EL synced as today, derives payload attributes for any parent variant, issues `forkchoiceUpdated` and `getPayload` on the builder's behalf, validates and gossips bids, publishes envelopes and data columns. |
| Execution client(s) | Build payloads. Only ever talked to by a beacon node, exactly as today. The builder has no engine URL, no JWT secret.                                                                                                                                                        |
| Builder client      | Key, timing, pricing, bookkeeping. Talks to beacon nodes only.                                                                                                                                                                                                               |

The core argument for this split: everything the builder needs per slot (head and its payload variants, proposer preferences, randao, expected withdrawals, coverable balance, events) already lives in the beacon node, and the beacon node already contains the complete "build a payload on top of a given parent" pipeline for self-build (`produceBlockBody`: variant state resolution, `withParentPayloadApplied`, withdrawals, `targetGasLimit` from the proposer preferences pool, `forkchoiceUpdated`, `getPayload`). Exposing that pipeline is a re-parameterization, not new logic.

## 2. Beacon node API

Four routes, everything else reused. Names are placeholders.

| Route                                            | Purpose                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /eth/v1/payload_builder/bid_context/{slot}` | One query per decision: `head {root, slot}`, `candidates: [{variant, parentBlockHash, payloadAvailable, payloadTimely}]` for the full and empty parent variants, `proposerPreferences \| null`, `prevRandao`, `builder {balance, pendingWithdrawals, coverableValue}` from the head state via `canBuilderCoverBid`, `bestBids: [{variant, value}]` from the bid pool.                                       |
| `POST /eth/v1/payload_builder/payloads`          | `{slot, parentBlockRoot, parentBlockHash, suggestedFeeRecipient, targetGasLimit?}` → `{payloadId}`. The beacon node resolves the variant state exactly as self-build does, derives the attributes and issues `forkchoiceUpdated`. Idempotent per tuple through `PayloadIdCache`. Blocks, bounded, until the parent payload is importable in its EL, so the builder never has to reason about EL sync state. |
| `GET /eth/v1/payload_builder/payloads/{id}`      | `engine_getPayload` passthrough: `{executionPayload, executionRequests, blobsBundle, executionPayloadValue}` plus a pre-filled unsigned bid template (everything except `value`, `builderIndex`). Repeatable, ELs return the best payload so far.                                                                                                                                                           |
| `POST /eth/v1/payload_builder/bids`              | `SignedExecutionPayloadBid` → publish (flood) and add to the pool on full validation, as in the implemented design.                                                                                                                                                                                                                                                                                         |

Reused as is: `publishExecutionPayloadEnvelope` (stateless flow with blobs and proofs), `getStateBuilders`, the `block`, `execution_payload`, `proposer_preferences` and `head_v2` events.

A single blocking `build({..., waitMs})` call is the simpler variant of the two payload routes if the beacon node should stay fully stateless; two phases mirror the Engine API and let the builder control the deadline with its own clock.

### Stateful variant

The beacon node can additionally keep the produced payload and blobs in its own cache keyed by block hash, as `blockProductionCache` does for self-build, and reveal through the existing stateful envelope flow (`getExecutionPayloadEnvelope` plus `publishExecutionPayloadEnvelope` without blobs). Fewer bytes over HTTP, but the reveal is then tied to the cache of one beacon node and does not survive a restart. The stateless variant, with the builder holding the payload material, was preferred.

## 3. Builder client

Identical to the implemented design except for the payload source:

```
PayloadSource.prepare(req)    → POST payloads         (instead of forkchoiceUpdated)
PayloadSource.getPayload(h)   → GET payloads/{id}     (instead of getPayload)
```

`bid_context` replaces the `payload_attributes` event as the build trigger input: the builder opens a `SlotBidder` for slot S on the `head` event for slot S-1, fetches `bid_context(S)`, prepares the empty variant immediately and the full variant on the `execution_payload` event, then at the deadline fetches payloads, prices and bids. Multiple execution clients are multiple beacon node plus EL pairs, each wrapped as a `BeaconNodePayloadSource`; one primary beacon node serves context and publishing.

Because the beacon node waits for the parent payload inside `prepare`, the builder needs no retry loop for a syncing EL. Because the builder still owns the payload material, the reveal path is unchanged.

## 4. Trade-offs against the implemented design

Advantages:

- **Single writer to the EL.** Only the beacon node issues `forkchoiceUpdated`, so there is no second caller that could move the EL head or its safe/finalized view, and no need to emit the forkchoice state to anyone.
- **No engine access in the builder.** No JWT secret, no engine URL, nothing to expose on managed or remote execution clients. The builder is a pure beacon API client.
- **Attribute derivation stays internal.** No event extension is needed, the beacon node computes attributes per request from the exact variant state.
- **Simpler builder.** No EL sync handling, no retry loop, no Engine API client dependency.

Disadvantages:

- **More beacon node surface and state.** Four new routes, a `payloadId` lifecycle owned by the API, and a request that blocks on EL import.
- **Lodestar only.** The routes are not part of any spec; the builder cannot run against another beacon node.
- **Beacon node on the build latency path.** One extra hop per build step. Negligible on localhost, real for a remote beacon node.
- **Multiple ELs need multiple beacon nodes.** The beacon node builds on one EL, so parallel builds on several ELs mean one beacon node per EL.
- **Less build control.** Polling `getPayload` repeatedly, per EL timing and attribute tweaks all go through the beacon node.

The implemented design was chosen because the beacon node must provide the payload attributes either way (they depend on the variant state), so the only thing mediation saves is the Engine API connection, at the cost of a larger, Lodestar-specific beacon node surface. Portability of the builder across beacon node and EL implementations weighed more.

## 5. When to revisit

- The engine port cannot be reached from where the builder runs, for example managed execution clients or strict network separation.
- The two-writer `forkchoiceUpdated` interaction turns out to be problematic on some EL, for example a later `forkchoiceUpdated` without attributes cancelling a builder's in-progress build.
- Operators want one beacon node to front several ELs for building; in that case a beacon node side fan-out would make this design strictly more capable than the implemented one.

Adding it does not require changing the rest of the builder: it is a second `PayloadSource` implementation plus the beacon node routes above.
