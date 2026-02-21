# Task: Refactor Gloas Envelope Pipeline — Separated Caches

Read `~/.openclaw/workspace/CODING_CONTEXT.md` for Lodestar project conventions.

## Overview

Replace the hacky `scheduleDeferredEnvelopeImport` retry loop in gossip handlers with a proper separated pipeline using `PayloadEnvelopeInput` and `SeenPayloadEnvelopeCache`.

## Step 1: Create `PayloadEnvelopeInput`

**File**: `packages/beacon-node/src/chain/blocks/payloadEnvelopeInput.ts`

Create a lightweight data class (NOT extending AbstractBlockInput):

```typescript
import type {RootHex, Slot, ValidatorIndex} from "@lodestar/types";
import type {gloas} from "@lodestar/types";

export type BidInfo = {
  blockRootHex: RootHex;
  slot: Slot;
  builderIndex: ValidatorIndex;
  blockHashFromBid: RootHex;
};

/**
 * Represents the envelope pipeline context for a Gloas block.
 * Created from the bid in the beacon block body as soon as the block passes gossip validation.
 * The bid is needed for gossip validation of both the envelope and data columns.
 */
export class PayloadEnvelopeInput {
  readonly blockRootHex: RootHex;
  readonly slot: Slot;
  readonly builderIndex: ValidatorIndex;
  readonly blockHashFromBid: RootHex;

  private _envelope: gloas.SignedExecutionPayloadEnvelope | null = null;

  private constructor(bid: BidInfo) {
    this.blockRootHex = bid.blockRootHex;
    this.slot = bid.slot;
    this.builderIndex = bid.builderIndex;
    this.blockHashFromBid = bid.blockHashFromBid;
  }

  /**
   * The only way to create a PayloadEnvelopeInput.
   * The bid is required for gossip validation of both the envelope and data columns.
   */
  static createFromBid(bid: BidInfo): PayloadEnvelopeInput {
    return new PayloadEnvelopeInput(bid);
  }

  hasEnvelope(): boolean {
    return this._envelope !== null;
  }

  setEnvelope(envelope: gloas.SignedExecutionPayloadEnvelope): void {
    this._envelope = envelope;
  }

  getEnvelope(): gloas.SignedExecutionPayloadEnvelope {
    if (this._envelope === null) {
      throw Error(`PayloadEnvelopeInput has no envelope for blockRoot=${this.blockRootHex}`);
    }
    return this._envelope;
  }
}
```

Also add an export from `packages/beacon-node/src/chain/blocks/payloadEnvelopeInput.ts` in the appropriate index file (if there is one in `blocks/`).

## Step 2: Create `SeenPayloadEnvelopeCache`

**File**: `packages/beacon-node/src/chain/seenCache/seenPayloadEnvelopeCache.ts`

```typescript
import type {CheckpointWithHex} from "@lodestar/fork-choice";
import type {RootHex} from "@lodestar/types";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import type {Metrics} from "../../metrics/metrics.js";
import type {BidInfo, PayloadEnvelopeInput} from "../blocks/payloadEnvelopeInput.js";
// Import PayloadEnvelopeInput from the new file

const MAX_PAYLOAD_ENVELOPE_CACHE_SIZE = 64;

/**
 * Cache for PayloadEnvelopeInput instances, keyed by block root.
 * Separate from SeenBlockInput — this is the envelope pipeline's cache.
 */
export class SeenPayloadEnvelopeCache {
  private cache = new Map<RootHex, PayloadEnvelopeInput>();

  constructor(private readonly metrics: Metrics | null) {}

  /**
   * Create a PayloadEnvelopeInput from bid info and store it.
   * Called from the block gossip handler after validation succeeds.
   */
  createFromBid(bid: BidInfo): PayloadEnvelopeInput {
    const existing = this.cache.get(bid.blockRootHex);
    if (existing) {
      return existing;
    }
    const input = PayloadEnvelopeInput.createFromBid(bid);
    this.cache.set(bid.blockRootHex, input);
    this.pruneToMaxSize();
    return input;
  }

  get(blockRootHex: RootHex): PayloadEnvelopeInput | undefined {
    return this.cache.get(blockRootHex);
  }

  has(blockRootHex: RootHex): boolean {
    return this.cache.has(blockRootHex);
  }

  prune(blockRootHex: RootHex): void {
    this.cache.delete(blockRootHex);
  }

  onFinalized(checkpoint: CheckpointWithHex): void {
    const cutoffSlot = computeStartSlotAtEpoch(checkpoint.epoch);
    for (const [rootHex, input] of this.cache) {
      if (input.slot < cutoffSlot) {
        this.cache.delete(rootHex);
      }
    }
  }

  get size(): number {
    return this.cache.size;
  }

  private pruneToMaxSize(): void {
    if (this.cache.size <= MAX_PAYLOAD_ENVELOPE_CACHE_SIZE) return;
    // Evict oldest by slot
    const sorted = [...this.cache.entries()].sort((a, b) => a[1].slot - b[1].slot);
    let toDelete = this.cache.size - MAX_PAYLOAD_ENVELOPE_CACHE_SIZE;
    for (const [rootHex] of sorted) {
      if (toDelete <= 0) break;
      this.cache.delete(rootHex);
      toDelete--;
    }
  }
}
```

## Step 3: Wire `SeenPayloadEnvelopeCache` into the chain

### `packages/beacon-node/src/chain/interface.ts`

Add to the `IBeaconChain` interface:

```typescript
seenPayloadEnvelopeCache: SeenPayloadEnvelopeCache;
```

### `packages/beacon-node/src/chain/chain.ts`

- Import `SeenPayloadEnvelopeCache`
- Initialize in constructor: `this.seenPayloadEnvelopeCache = new SeenPayloadEnvelopeCache(metrics);`
- Wire `onFinalized` to chain events (same pattern as `seenBlockInputCache`):
  ```typescript
  this.emitter.on(ChainEvent.forkChoiceFinalized, (checkpoint) => {
    this.seenPayloadEnvelopeCache.onFinalized(checkpoint);
  });
  ```

## Step 4: Refactor gossip handlers

### `packages/beacon-node/src/network/processor/gossipHandlers.ts`

**REMOVE entirely:**

- `pendingExecutionPayloadEnvelopesByBlockRoot` Map
- `processingDeferredEnvelopeRoots` Set
- `scheduleDeferredEnvelopeImport` function and all its contents
- Any references to these in the block gossip handler (the `if (pendingExecutionPayloadEnvelopesByBlockRoot.has(...))` check)

**ADD: Early envelope cache** (lightweight, bounded):

```typescript
// Bounded cache for envelopes that arrive before their beacon block
const MAX_EARLY_ENVELOPES = 64;
const earlyEnvelopes = new Map<string, {envelope: gloas.SignedExecutionPayloadEnvelope; seenTimestampSec: number}>();
```

**MODIFY `validateBeaconBlock` function:**
After `validateGossipBlock()` succeeds AND `blockInput` is created, if the block is post-Gloas:

1. Extract bid from block body:
   ```typescript
   const bid = (signedBlock.message as gloas.BeaconBlock).body.signedExecutionPayloadBid.message;
   ```
2. Create PayloadEnvelopeInput and store in cache:
   ```typescript
   const bidInfo: BidInfo = {
     blockRootHex,
     slot: signedBlock.message.slot,
     builderIndex: bid.builderIndex,
     blockHashFromBid: toRootHex(bid.blockHash),
   };
   chain.seenPayloadEnvelopeCache.createFromBid(bidInfo);
   ```
3. Check if an early envelope exists for this block root:
   ```typescript
   const early = earlyEnvelopes.get(blockRootHex);
   if (early) {
     earlyEnvelopes.delete(blockRootHex);
     // Process asynchronously to not block block import
     void (async () => {
       try {
         await validateGossipExecutionPayloadEnvelope(chain, early.envelope);
         await chain.importExecutionPayloadEnvelope(early.envelope);
         logger.info("Imported early execution payload envelope", {
           slot: early.envelope.message.slot,
           blockRoot: blockRootHex,
         });
       } catch (e) {
         logger.warn("Failed importing early execution payload envelope", {blockRoot: blockRootHex}, e as Error);
       }
     })();
   }
   ```

**MODIFY `[GossipType.execution_payload]` handler:**
Replace the current BLOCK_ROOT_UNKNOWN catch-and-queue logic:

```typescript
[GossipType.execution_payload]: async ({gossipData, topic, seenTimestampSec}) => {
  const {serializedData} = gossipData;
  const executionPayloadEnvelope = sszDeserialize(topic, serializedData);
  const blockRootHex = toRootHex(executionPayloadEnvelope.message.beaconBlockRoot);

  // Check if bid context is available (block already gossip-validated)
  const envelopeInput = chain.seenPayloadEnvelopeCache.get(blockRootHex);
  if (!envelopeInput) {
    // Envelope arrived before its block — store in early envelope cache
    if (earlyEnvelopes.size >= MAX_EARLY_ENVELOPES) {
      // Evict oldest entry
      const firstKey = earlyEnvelopes.keys().next().value;
      if (firstKey !== undefined) earlyEnvelopes.delete(firstKey);
    }
    earlyEnvelopes.set(blockRootHex, {envelope: executionPayloadEnvelope, seenTimestampSec});
    chain.emitter.emit(ChainEvent.unknownBlockRoot, {rootHex: blockRootHex, source: BlockInputSource.gossip});
    metrics?.gossipExecutionPayloadEnvelope.earlyEnvelopeCount?.inc();
    return;
  }

  try {
    await validateGossipExecutionPayloadEnvelope(chain, executionPayloadEnvelope);
  } catch (e) {
    throw e;
  }

  const slot = executionPayloadEnvelope.message.slot;
  const delaySec = seenTimestampSec - computeTimeAtSlot(config, slot, chain.genesisTime);
  metrics?.gossipExecutionPayloadEnvelope.elapsedTimeTillReceived.observe({source: OpSource.gossip}, delaySec);

  await chain.importExecutionPayloadEnvelope(executionPayloadEnvelope);
},
```

## Step 5: Refactor envelope validation

### `packages/beacon-node/src/chain/validation/executionPayloadEnvelope.ts`

The current `validateExecutionPayloadEnvelope` function gets bid info from `chain.forkChoice.getBlockDefaultStatus()`. For the gossip path, we now have bid info from `SeenPayloadEnvelopeCache`. However, for the API path (`validateApiExecutionPayloadEnvelope`), we may still need the fork-choice fallback.

Approach: Keep the existing fork-choice lookup as a fallback but also accept optional bid info. The gossip handler already checks `seenPayloadEnvelopeCache` before calling validation, so the fork-choice lookup in the validation function now serves as a safety check + API path.

**No changes needed to validation** if we keep the fork-choice lookup as the canonical bid source for validation. The key change is in the gossip handler (Step 4) which gates envelope processing on bid availability via the cache.

IMPORTANT: The `BLOCK_ROOT_UNKNOWN` error path in validation is still valid — it will fire for the API path if the block isn't in fork-choice. For the gossip path, we pre-check the cache and never call validation without bid context.

## Step 6: Clean up imports

Remove any unused imports from `gossipHandlers.ts` that were only needed for the old deferred mechanism (e.g., `sleep` if it was imported for the retry delay).

## Verification

After all changes:

1. `pnpm lint` (at minimum the changed files)
2. `pnpm check-types` (packages/beacon-node)
3. `pnpm build` (packages/beacon-node)
4. Run any existing unit tests: `pnpm test:unit packages/beacon-node/test/`

## Key constraints

- Do NOT modify fork-choice code
- Do NOT modify block import code
- Do NOT modify notifier code
- Only touch: gossip handlers, envelope validation, chain interface/constructor, and the two new files
- Use spec terminology (avoid "epbs" in new code/comments — say "Gloas", "PayloadBid", "envelope")
- Follow Lodestar coding conventions (see CODING_CONTEXT.md)
