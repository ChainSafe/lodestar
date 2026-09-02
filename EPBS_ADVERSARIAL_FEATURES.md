# ePBS (gloas) Adversarial Node: Potential Features

Status: catalog. Seven features shipped so far (Tier 1 #1, #2, #4, #4b, #4c, #4d, and Tier 2 #6,
see Conventions); the rest are planned.

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
   grouped by attack topic under a dedicated `adversarial.*` namespace. Beacon-node
   flags are defined in `packages/cli/src/options/beaconNodeOptions/adversarial.ts`
   and consumed into the chain options bag by `chain.parseArgs`; validator-duty
   flags are defined in `packages/cli/src/cmds/validator/options.ts` and consumed
   into `ValidatorOptions`. Mark the option `hidden: true`, and prefix the
   description with "ADVERSARIAL (devnet test only)".
2. Parameterized via CLI thresholds wherever the behavior has a tunable knob
   (probability, delay or timing offset, value cutoff, count, target subset),
   each with a sensible default. Never hardcode the knob.

Naming: `adversarial.<topic>.<behavior>`, one sub-namespace per attack topic
(`reorg`, `withhold`, `ptc`, `equivocate`, `censor`, `bid`, ...). The internal
`IChainOptions` field is the flattened topic-prefixed camelCase name, e.g.
`adversarial.reorg.buildOnEmpty` -> `adversarialReorgBuildOnEmpty`.

Default-OFF wiring: beacon-node features set the default `false` in
`defaultChainOptions` (`packages/beacon-node/src/chain/options.ts`); validator
features set it in their CLI option and when constructing `Validator`. In
`chain.parseArgs`, map plain `args["adversarial.<topic>.<behavior>"]` so an unset
beacon-node flag is stripped by `removeUndefinedRecursive` and the default
survives the merge, while `=true` enables it. Keep the lib consumer a plain
truthy check (`if (this.opts?.<field>)`) so shared-lib unit tests built with no
opts stay OFF and do not break.

First feature shipped this way: `--adversarial.reorg.buildOnEmpty` (Tier 1 #4,
always build on the EMPTY parent variant; default false). It is binary, so it has
no threshold. Second: `--adversarial.reorg.omitPtcAttestations` (Tier 1 #4b, omit
the reorged slot's PTC attestations when building on empty; default false, also binary).
Third: `--adversarial.reorg.delayLastSlotProposal` (Tier 1 #4c, delay the final
slot's block until `--adversarial.reorg.lastSlotProposalDelayBps`, default 4000
basis points into the slot). Fourth:
`--adversarial.reorg.buildOnParentInLastSlot` (Tier 1 #4d, make the final-slot
proposer build on the current head's parent even when the head is strong; default
false). Fifth: `--adversarial.equivocate.blockProposal` (Tier 2 #6, when the
proposer selects an external builder bid, split the network into two disjoint peer
sets, gossiping a valid self-built block to the majority and the builder block to
the minority so the view splits and resolves to the self-built block, sized by
`--adversarial.equivocate.builderBlockPeersBps` (default 4000 = 40%); default false).
Sixth: `--adversarial.withhold.executionPayload` (Tier 1 #1, publish a self-built
beacon block but never its execution payload envelope; default false). Seventh:
`--adversarial.delay.executionPayload` (Tier 1 #2, publish a self-built beacon
block immediately but hold its envelope until
`--adversarial.delay.executionPayloadBps`, default 8000 basis points into the
slot; default false). Eighth and ninth: `--adversarial.bid.blockHashEqualsParentStall` and
`--adversarial.bid.blockHashEqualsParentMisclassify` (Tier 1 #1b, two beacon-node
chain flags that set a self-built bid's `block_hash` equal to its
`parent_block_hash`, differing only in the committed `execution_requests_root` —
a non-empty sentinel to stall the branch, or the empty root to let the honest
child import and misclassify the parent; both binary, default false, stall wins
if both are set; pair with `--adversarial.withhold.executionPayload`).

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
- `BUILDER_INDEX_SELF_BUILD = UINT64_MAX`: proposer self-build sentinel,
  represented as `Infinity` by Lodestar's uint64 number type.
- `BUILDER_INDEX_FLAG = 2^40`: withdrawal index flag for builders.

---

## Tier 1: Core ePBS safety / liveness (highest impact, most spec-relevant)

### 1. Payload withholding (the canonical ePBS attack)

Implemented as the validator-client flag
`--adversarial.withhold.executionPayload`. It applies only to self-built Gloas
blocks and returns after publishing the signed beacon block, before retrieving,
signing, or publishing its envelope.

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

### 1b. Bid block_hash equals parent_block_hash (ambiguous EMPTY/FULL parent)

Implemented as two beacon-node chain flags,
`--adversarial.bid.blockHashEqualsParentStall` and
`--adversarial.bid.blockHashEqualsParentMisclassify`. For self-built Gloas blocks
both set `bid.block_hash = bid.parent_block_hash` at bid construction in
`produceBlockBody.ts` (instead of the real `executionPayload.blockHash`). They
differ only in the committed `execution_requests_root`: the stall flag commits a
non-empty sentinel root, the misclassify flag commits the empty root. If both are
set, stall wins.

A winning bid with `block_hash == parent_block_hash` whose payload is withheld
makes every honest child ambiguous: the child must set `parent_block_hash =
latest_block_hash`, which now equals the malicious parent bid's `block_hash`, so
`get_parent_payload_status` / `process_parent_execution_payload` classify the
parent as FULL even though its payload was EMPTY. The child can never
unambiguously encode that the parent was EMPTY.

- Injection point: bid assembly in
  `packages/beacon-node/src/chain/produceBlock/produceBlockBody.ts` (self-build
  branch), gated on `this.opts?.adversarialBidBlockHashEqualsParentStall` /
  `...Misclassify`.
- The requests root selects the outcome. The honest child builds on EMPTY, so it
  carries empty `parentExecutionRequests`, but the `block_hash == parent_block_hash`
  collision routes its state transition into the FULL branch of
  `process_parent_execution_payload`, which asserts
  `hash_tree_root(child.parentExecutionRequests) == parent_bid.execution_requests_root`.
  - Stall (non-empty sentinel root): the assert fails, so the honest proposer
    throws during state-root computation and cannot produce the child. Spec-literal
    clients reject even earlier: `on_block` asserts `is_payload_verified` for a FULL
    parent, which never holds for a withheld payload. No child of the malicious
    block can be produced or imported, and the branch stalls until reorged out. A
    sentinel is used rather than the real payload's requests root because a payload
    with zero execution requests hashes to the empty root, collapsing into the
    misclassify case.
  - Misclassify (empty root): the assert passes, so the child IMPORTS and then
    silently mis-settles the withheld parent (builder payment, availability bit,
    dropped withdrawals batch). This is the dangerous, spec-relevant path.
- Cross-client split (misclassify): Lodestar's fork choice resolves the parent to
  EMPTY by variant-hash lookup and keeps importing children, while its state
  transition still treats the parent as FULL, so a mixed network diverges between
  Lodestar and spec-literal clients.
- Pair with `--adversarial.withhold.executionPayload` (validator flag) so the
  proposer never attempts the doomed envelope reveal. The bid flag alone still
  reproduces the shape, since the committed hash is unverifiable either way;
  withholding just keeps the run quiet.
- Spec status: no consensus-specs rule rejects this bid shape as of writing;
  candidate fix is a REJECT in `process_execution_payload_bid` and bid gossip.

### 2. Late payload reveal (timing straddle)

Implemented as `--adversarial.delay.executionPayload`, with the target publish
time selected by `--adversarial.delay.executionPayloadBps`. The target is a
fraction of the slot, not an additional sleep, so production time is accounted
for. Set it after `PAYLOAD_DUE_BPS` and before 10000 to make honest PTC members
vote `payloadPresent=false` while still giving the next proposer time to receive
the late payload. The envelope may arrive before `PAYLOAD_ATTESTATION_DUE_BPS`;
timeliness is determined from its recorded arrival time against
`PAYLOAD_DUE_BPS`. A target at or after `PAYLOAD_ATTESTATION_DUE_BPS` additionally
exercises the race where PTC members vote before the envelope arrives.

- Injection point: configurable delay before the publish call in #1.
- Effect: after `PAYLOAD_DUE_BPS`, honest PTC members vote NO and the next
  proposer should extend EMPTY even though the late FULL payload remains locally
  available. Targets near either timing boundary can additionally stress
  inconsistent arrival views across nodes.

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

### 4c. Delayed final-slot proposal (epoch-boundary late head)

When proposing the final slot of an epoch, produce the block normally but delay
returning it to the validator until late in the slot. This lets the block become
head shortly before the next epoch begins and gives the slot 0 proposer a chance
to orphan it.

- Injection point: delay the `produceBlockV4` response in
  `packages/beacon-node/src/api/impl/validator/index.ts`.
- Timing: `--adversarial.reorg.lastSlotProposalDelayBps` selects the target time
  as a fraction of the slot duration. It defaults to 4000 basis points, after
  Gloas's 2500-basis-point attestation deadline and Lighthouse's observed
  one-third-slot late-block threshold, leaving 60% of the slot for the late
  block to become the network head before the epoch boundary.
- Effect: exercises late-head handling and dependent-root changes at an epoch
  boundary. Payload-only withholding is insufficient because it does not remove
  the beacon block that supplies the dependent root.

### 4d. Build the final-slot block on the current head's parent

When proposing the final slot of an epoch and the current head is from the
previous slot, deliberately use that head's parent as the proposer head even when
the current head is strong.

- Injection point: adversarial override at the start of `getProposerHead` in
  `packages/fork-choice/src/forkChoice/forkChoice.ts`.
- Effect: the final-slot block is built beside the current head instead of on
  top of it, forcing a single-slot reorg immediately before the epoch boundary.
- Modes: use this independently from #4c. The delayed-proposal mode lets another
  client's slot 0 proposer decide whether to reorg the weak final-slot head.

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

Produce two valid beacon blocks for slot N committing to different bids or
parents and split the network's view of which is canonical. The implemented
variant activates when the primary block selects an external builder bid: the
proposer produces a self-built sibling on the same parent, then the beacon node
partitions its peers into two disjoint sets and, in one operation, gossips the
self-built (canonical) block to the majority and the builder block to the minority
(`builderBlockPeersBps`, default 40%) back to back. Each set observes its own block
one hop before the other block's two-hop relay arrives, and because honest nodes
IGNORE and do not relay a second block from the same proposer (REPEAT_PROPOSAL),
the split is stable: the minority follows the builder block (so the builder, if
among them, reveals its payload) while the majority follows the self-built block.
Since the minority stays below half, the self-built block wins fork choice and the
split heals to it over later slots. Publishing both blocks simultaneously to
disjoint sets is essential: publishing either block first lets it relay network-
wide and win outright (an earlier flood-then-seed version failed for exactly this
reason, see git history).

- Effect: tests block dedup, proposer slashing, split-view fork choice (a real
  competing fork that must lose), and how the bid-to-envelope binding copes with a
  revealed-but-orphaned builder payload.
- Injection point: produce the self-built sibling through `produceBlockV4` with a
  zero builder boost factor and sign the builder block bypassing slashing
  protection in `packages/validator/src/services/block.ts`; both blocks are handed
  to the hidden `lodestar.publishBlockEquivocation` route, which imports the
  self-built block locally (required so its payload envelope can be revealed) and
  drives the disjoint dual-publish via `publishPartition` in
  `packages/beacon-node/src/network/gossip/gossipsub.ts`.
- Caveat: reaching the actual builder is best-effort (no builderIndex->peerId
  mapping); a larger minority fraction raises the odds the builder is in it but
  must stay below half or the builder fork wins. Peer-fraction approximates
  attester-weight-fraction only when validators are spread evenly across nodes.

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
