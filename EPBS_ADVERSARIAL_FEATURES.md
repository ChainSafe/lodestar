# ePBS (gloas) Adversarial Node: Potential Features

Status: catalog. Two features shipped so far (Tier 1 #4 and #4b, see Conventions);
the rest are planned.

Purpose: a list of adversarial behaviors we could build into a test-only "deathstar"
Lodestar build to stress the gloas (ePBS) fork on a devnet, find consensus
safety/liveness weaknesses, and harden the spec before mainnet. This is the same
category of work as attacknet, beacon-fuzz, and the equivocation/fork-choice
attack tests every CL client maintains. All of it is intended for isolated
devnets (Kurtosis / local), never against a public network.

## Conventions (apply to every feature here)

Every adversarial behavior MUST be:

1. Individually toggleable via a CLI flag, and DEFAULT OFF so focused tests can
   enable only the behavior under test with
   `--adversarial.<topic>.<behavior>=true`. Flags are
   grouped by attack topic under a dedicated `adversarial.*` namespace, defined in
   `packages/cli/src/options/beaconNodeOptions/adversarial.ts` and consumed into the
   chain options bag by `chain.parseArgs` (the same cross-group pattern the
   `builder.*` circuit-breaker flags use). Mark the option `hidden: true`, and
   prefix the description with "ADVERSARIAL (devnet test only)".
2. Parameterized via CLI thresholds wherever the behavior has a tunable knob
   (probability, delay or timing offset, value cutoff, count, target subset),
   each with a sensible default. Never hardcode the knob.

Naming: `adversarial.<topic>.<behavior>`, one sub-namespace per attack topic
(`reorg`, `withhold`, `ptc`, `equivocate`, `censor`, `bid`, ...). The internal
`IChainOptions` field is the flattened topic-prefixed camelCase name, e.g.
`adversarial.reorg.buildOnEmpty` -> `adversarialReorgBuildOnEmpty`.

Default-OFF wiring: set the default `false` in
`defaultChainOptions` (`packages/beacon-node/src/chain/options.ts`); in
`chain.parseArgs` map plain `args["adversarial.<topic>.<behavior>"]` so an unset
flag is stripped by `removeUndefinedRecursive` and the default survives the merge,
while `=true` enables it. Keep the lib consumer a plain truthy check
(`if (this.opts?.<field>)`) so shared-lib unit tests built with no opts stay OFF
and do not break.

First feature shipped this way: `--adversarial.reorg.buildOnEmpty` (Tier 1 #4,
always build on the EMPTY parent variant; default false). It is binary, so it has
no threshold. Second: `--adversarial.reorg.omitPtcAttestations` (Tier 1 #4b, omit
the reorged slot's PTC attestations when building on empty; default false, also binary).

## How ePBS changes the threat model

Pre-gloas a block was atomic: header and payload shipped together as one signed
gossip object, and equivocation meant two blocks. Gloas splits this into a
pipeline of independently gossiped, independently signed messages:

```
proposer_preferences -> execution_payload_bid -> beacon_block (commits to bid)
  -> execution_payload (envelope, builder-signed) -> payload_attestation (PTC: timely?)
```

Every arrow is a new place to withhold, equivocate, delay, or lie. Three things
are genuinely new attack surfaces:

1. The execution payload is now a separate gossip object (`execution_payload`),
   revealed after the block, so it can be withheld, delayed, or equivocated
   independently of the block.
2. The Payload Timeliness Committee (PTC) vote feeds directly into the
   EMPTY-vs-FULL fork-choice decision, gated at exactly 50 percent
   (`PAYLOAD_TIMELY_THRESHOLD = PTC_SIZE / 2`). A threshold pinned at half the
   committee is the single richest adversarial lever in the fork.
3. The builder bid / payment / balance market is new economic state
   (`builders`, `builderPendingPayments`, `builderPendingWithdrawals`) that can
   be manipulated.

## Key parameters and thresholds

- `PTC_SIZE`: PTC members per slot (mainnet 512, minimal 2).
- `PAYLOAD_TIMELY_THRESHOLD = floor(PTC_SIZE / 2)`: >50 percent YES PTC votes
  marks a payload timely.
- `DATA_AVAILABILITY_TIMELY_THRESHOLD = floor(PTC_SIZE / 2)`: same for blob DA.
- `PAYLOAD_ATTESTATION_DUE_BPS`: when in the slot PTC members attest.
- `MAXIMUM_GOSSIP_CLOCK_DISPARITY`: timing tolerance to straddle.
- `BUILDER_INDEX_SELF_BUILD = 0`: proposer self-build sentinel.
- `BUILDER_INDEX_FLAG = 2^32`: withdrawal index flag for builders.

---

## Tier 1: Core ePBS safety / liveness (highest impact, most spec-relevant)

### 1. Payload withholding (the canonical ePBS attack)

Publish the beacon block and winning bid, then never publish the
`SignedExecutionPayloadEnvelope`.

- Injection point: skip `network.publishSignedExecutionPayloadEnvelope` in
  `packages/beacon-node/src/api/impl/beacon/blocks/index.ts` (around the publish
  fan-out), and the validator path in
  `packages/validator/src/services/block.ts`.
- Effect: block stays PENDING then resolves EMPTY; `processWithdrawals`
  early-exits and skips all withdrawals for that slot; PTC votes not-timely; the
  next proposer is forced to build on the empty variant. Exercises
  builder-payment forfeiture (`processBuilderPendingPayments` quorum should deny
  payment to a withholding builder) and empty-slot handling end to end.
- Variants: always / probabilistic / only when self-built / only above a
  bid-value threshold (maximize grief per slot).

### 2. Late payload reveal (timing straddle)

Reveal the envelope right at the PTC attestation deadline but still inside
`MAXIMUM_GOSSIP_CLOCK_DISPARITY`, so roughly half the PTC sees it as timely and
half as late.

- Injection point: configurable delay before the publish call in #1.
- Effect: PTC YES votes land near `PTC_SIZE / 2`, so `isPayloadTimely` resolves
  differently across nodes, producing network-wide EMPTY-vs-FULL head
  disagreement (split view). Highest-value liveness stressor.

### 3. Dishonest PTC voting

When acting as a PTC member, set `payloadPresent` and/or `blobDataAvailable` to
the opposite of what was actually observed.

- Injection point: override the attestation data flags in
  `packages/validator/src/services/ptc.ts` before signing.
- Effect: with enough malicious PTC weight (>50 percent) this flips
  `shouldExtendPayload`, forcing FULL when the payload was withheld or EMPTY when
  it was present. Direct control of head selection via
  `protoArray.shouldExtendPayload` and `getPayloadStatusTiebreaker`.

### 4. Payload-withholding reorg (builder + proposer self-collusion)

At slot N, as the builder, withhold the payload. At slot N+1, as the proposer,
deliberately build on the EMPTY variant of N, orphaning N's would-be full block.

- Injection point: force the `shouldBuildOnFull` / `bidParentBlockHash` branch in
  `packages/beacon-node/src/api/impl/validator/index.ts` (`produceBlockV4`) to
  select the empty parent.
- Effect: exercises the new payload-status reorg resistance and its interaction
  with proposer boost. The ePBS analog of an ex-ante reorg. Composes with #1.

### 4b. Omit PTC attestations when building on empty (withhold reorg evidence)

When building on the EMPTY parent variant (#4), also drop the parent slot's
`payload_attestations` from the produced block — exactly the votes that prove the
orphaned payload was timely. A reorging proposer naturally would not advertise the
evidence against its own reorg.

- Injection point: gate the `getPayloadAttestationsForBlock` call on the
  build-on-empty branch in
  `packages/beacon-node/src/chain/produceBlock/produceBlockBody.ts` (both the
  builder-bid `!isExtendingPayload` and self-build `!isBuildingOnFull` paths) and
  pack `[]` instead.
- Effect: consumers that tally PTC timeliness from the on-chain aggregate's bits
  WITHOUT self-expanding a validator's vote to all its positions (e.g. Prysm:
  `process_block.go handleBlockPayloadAttestations`, gossip + own production are
  1-bit/validator) fall back to their gossip-only count (~committee size, below
  `PAYLOAD_TIMELY_THRESHOLD`) and treat the genuinely timely payload as
  not-timely, so they FOLLOW the reorg instead of rejecting it. Clients that
  self-expand from gossip (Lodestar #5222) still reject it. Composes with #4: it
  turns #4 from a self-defeating "dumb" reorg (the reorg block ships the proof
  against itself) into one that flips non-self-expanding clients.

---

## Tier 2: Equivocation and split-view

### 5. Envelope equivocation

Produce two different signed envelopes (different `blockHash`) for the same
beacon-block root and flood them to disjoint peer subsets.

- Note: gossip dedups envelopes by block root (`ENVELOPE_ALREADY_KNOWN` -> IGNORE
  in `chain/validation/executionPayloadEnvelope.ts`), so first-seen-wins per
  peer. There is currently no builder-equivocation slashing, so the network
  should partition on payload content.
- Injection point: build two envelopes; use per-peer targeted publish on the
  `network.ts` gossip methods.

### 6. Proposer equivocation (ePBS-flavored)

Produce two beacon blocks for slot N committing to different bids or parents,
gossip to disjoint peer subsets.

- Effect: tests block dedup, proposer slashing, and how the bid-to-envelope
  binding copes with two competing blocks for one slot.

### 7. PTC vote splitting / withholding

Withhold or split PTC votes to pin a block exactly at the timeliness threshold,
maximizing per-node disagreement about EMPTY vs FULL.

### 8. Proposer-preference censorship

A builder bid is IGNORED unless a matching `proposer_preferences` exists
(`NO_MATCHING_PROPOSER_PREFERENCES` in `chain/validation/executionPayloadBid.ts`).
A malicious proposer that simply never publishes its preferences blocks all
external builder bids for its slot, forcing self-build or empty.

- Effect: a clean liveness / censorship lever that emits no malformed messages at
  all (purely an omission).

---

## Tier 3: Market manipulation, resource exhaustion, fuzz

### 9. Bid overbidding

Gossip bids whose value exceeds the builder balance (bypass `canBuilderCoverBid`).
Honest nodes IGNORE at gossip (`BID_TOO_HIGH`); useful combined with a colluding
proposer to drive the `processExecutionPayloadBid` balance and pending-payment
accounting.

### 10. Bid spam / topic flooding

Flood `execution_payload_bid` with max-blob bids (1024 FIFO queue, one BLS verify
per bid) for validation DoS and dropped legitimate bids. Generalize to all four
new topics: `execution_payload`, `payload_attestation_message`,
`execution_payload_bid`, `proposer_preferences`.

### 11. Bid flip-flop

Many bids for the same slot, then reveal a payload for a non-winning bid.
Stresses bid-pool best-bid selection and dedup
(`chain/opPools/executionPayloadBidPool.ts`, `seenCache/seenExecutionPayloadBids.ts`).

### 12. Invalid / mismatched envelope

Corrupt `blockHash`, `builderIndex`, or `executionRequestsRoot` so they disagree
with the committed bid. Honest nodes REJECT
(`chain/blocks/verifyExecutionPayloadEnvelope.ts`); good for fuzzing the verify
path and confirming peer-scoring penalties fire.

### 13. Req/resp griefing

Never-respond or serve garbage on `ExecutionPayloadEnvelopesByRoot` and
`ExecutionPayloadEnvelopesByRange`, stalling payload sync for late joiners.

---

## Tier 4: Accounting edge cases (need a colluding proposer to land on-chain)

### 14. Builder-payment manipulation

Exploit the two-epoch payment window plus quorum in
`processBuilderPendingPayments`. Confirm a withholding builder is correctly denied
payment, and probe double-counting between pending payments and pending
withdrawals.

### 15. Withdrawal-ordering edge cases

Probe the gloas withdrawal order (builder payments, then partial withdrawals,
then builder sweep, then validator sweep), the EMPTY early-exit in
`processWithdrawals`, and the `BUILDER_INDEX_FLAG` encoding.

---

## Suggested architecture (for when we build)

A single `adversarial` options namespace plumbed into `BeaconChain` and the
validator client, gated behind an obvious test-only, hidden `--adversarial.*` CLI
namespace so it can never ship. Most behaviors require
bypassing Lodestar's own outbound correctness (the node will not normally sign an
invalid envelope or skip a duty), so the clean injection layer is production plus
publish, not the inbound validation functions:

- Block / bid production: `chain/produceBlock/produceBlockBody.ts`,
  `api/impl/validator/index.ts` (`produceBlockV4`).
- Envelope reveal: `api/impl/beacon/blocks/index.ts`,
  `validator/src/services/block.ts` (delay / skip / duplicate / corrupt).
- PTC duty: `validator/src/services/ptc.ts` (flip flags / withhold).
- Gossip fan-out: the `network.ts` publish methods (per-peer targeting for
  equivocation).
- Optional: a switch to disable the proposer / builder self-checks so the node
  emits deliberately invalid messages.

Each feature is roughly one flag plus one guarded branch at these sites, and they
compose (for example #1 plus #4 gives the collusion reorg).

## Suggested priority

Start with Tier 1. It is the smallest amount of code (mostly skip / delay / flip
at three sites) for the largest, most spec-relevant impact. Features #1 and #3
together already reproduce the headline ePBS failure modes on a Kurtosis devnet.

## Reference: key files

- Fork choice: `packages/fork-choice/src/protoArray/protoArray.ts`
  (`shouldExtendPayload`, `shouldBuildOnFull`, `isPayloadTimely`,
  `getPayloadStatusTiebreaker`, `notifyPtcMessages`).
- State transition: `packages/state-transition/src/block/`
  (`processExecutionPayloadBid.ts`, `processParentExecutionPayload.ts`,
  `processPayloadAttestation.ts`, `processWithdrawals.ts`) and
  `epoch/processBuilderPendingPayments.ts`, `epoch/processPtcWindow.ts`.
- Gossip validation: `packages/beacon-node/src/chain/validation/`
  (`executionPayloadEnvelope.ts`, `payloadAttestationMessage.ts`,
  `executionPayloadBid.ts`, `proposerPreferences.ts`).
- Envelope verify / import: `packages/beacon-node/src/chain/blocks/`
  (`verifyExecutionPayloadEnvelope.ts`, `payloadEnvelopeProcessor.ts`).
- Production / duties: `packages/beacon-node/src/api/impl/validator/index.ts`,
  `packages/validator/src/services/block.ts`,
  `packages/validator/src/services/ptc.ts`.
- Network publish + req/resp: `packages/beacon-node/src/network/network.ts`,
  `packages/beacon-node/src/network/reqresp/handlers/executionPayloadEnvelopesBy*.ts`.
