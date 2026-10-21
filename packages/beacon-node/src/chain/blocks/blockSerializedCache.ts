import {ChainForkConfig} from "@lodestar/config";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {Root, RootHex, SignedBeaconBlock, Slot, sszTypesFor} from "@lodestar/types";
import {LodestarError, Logger, byteArrayEquals, pruneSetToMax, toRootHex} from "@lodestar/utils";
import type {Metrics} from "../../metrics/index.js";
import {MAX_LOOK_AHEAD_EPOCHS} from "../../sync/constants.js";
import {SerializedCache} from "../../util/serializedCache.js";
import {getSlotFromSignedBeaconBlockSerialized} from "../../util/sszBytes.js";

export type BlockBytes = {blockRoot: Root; blockBytes: Uint8Array};
export type BlockSerializedCacheEntry = {block: SignedBeaconBlock; bytes: Uint8Array};
export type BlockSerializedCacheOwner = "engine";
export type BlockSerializedCacheDeleteReason = "explicit" | "persisted" | "rejected" | "block_input";
type BlockSerializedCacheOpts = {
  maxItems?: number;
  metrics?: Metrics["blockSerializedCache"] | null;
  logger?: Logger;
  serializedCache?: SerializedCache;
};

/**
 * Bounded reuse of decoded blocks and bytes by message root, without implying validation.
 * Owned by BeaconEngineCore for gossip validation and block processing only.
 * Entries may be removed on rejection, persistence, finalization or capacity eviction, or replaced by
 * another signature for the same root. BeaconEngine.verifiedBlocks independently retains the exact
 * block/bytes references needed for pending imports, so removal here cannot invalidate an import.
 * Callers must derive roots from the block and keep cached blocks and bytes immutable.
 */
export class BlockSerializedCache {
  private readonly entries = new Map<RootHex, BlockSerializedCacheEntry>();
  private readonly maxItems: number;
  private readonly owner: BlockSerializedCacheOwner = "engine";

  constructor(
    private readonly config: ChainForkConfig,
    private readonly opts: BlockSerializedCacheOpts = {}
  ) {
    this.maxItems = opts.maxItems ?? (MAX_LOOK_AHEAD_EPOCHS + 1) * SLOTS_PER_EPOCH;
    const {metrics} = opts;
    if (metrics) {
      metrics.size.addCollect(() => {
        let bytes = 0;
        for (const entry of this.entries.values()) bytes += entry.bytes.byteLength;
        metrics.size.set({owner: this.owner}, this.entries.size);
        metrics.bytes.set({owner: this.owner}, bytes);
      });
    }
  }

  get(blockRoot: RootHex): BlockSerializedCacheEntry | undefined {
    const entry = this.entries.get(blockRoot);
    this.opts.metrics?.lookups.inc({owner: this.owner, operation: "get", result: entry ? "hit" : "miss"});
    return entry;
  }

  /** The caller must derive the root from this block, and the bytes must encode this block. */
  set(blockRoot: RootHex, block: SignedBeaconBlock, bytes: Uint8Array): BlockSerializedCacheEntry {
    const cached = this.entries.get(blockRoot);
    if (cached && (cached.bytes === bytes || byteArrayEquals(cached.bytes, bytes))) return cached;
    const entry = {block, bytes};
    if (cached) this.opts.metrics?.removals.inc({owner: this.owner, reason: "replaced"});
    this.entries.delete(blockRoot);
    this.entries.set(blockRoot, entry);
    this.opts.metrics?.insertions.inc({owner: this.owner});
    const removed = pruneSetToMax(this.entries, this.maxItems);
    if (removed > 0) {
      this.opts.metrics?.removals.inc({owner: this.owner, reason: "capacity"}, removed);
      this.opts.logger?.debug("Pruned block cache", {
        owner: this.owner,
        reason: "capacity",
        removed,
        size: this.entries.size,
        maxItems: this.maxItems,
      });
    }
    return entry;
  }

  getOrSerialize(blockRoot: RootHex, block: SignedBeaconBlock): BlockSerializedCacheEntry {
    const cached = this.entries.get(blockRoot);
    const hit = cached && (cached.block === block || byteArrayEquals(cached.block.signature, block.signature));
    this.opts.metrics?.lookups.inc({owner: this.owner, operation: "serialize", result: hit ? "hit" : "miss"});
    if (hit) return cached;
    return this.set(blockRoot, block, this.config.getForkTypes(block.message.slot).SignedBeaconBlock.serialize(block));
  }

  getOrDeserialize(blockRoot: RootHex, bytes: Uint8Array, fork?: ForkName): BlockSerializedCacheEntry {
    const cached = this.entries.get(blockRoot);
    const hit = cached && (cached.bytes === bytes || byteArrayEquals(cached.bytes, bytes));
    this.opts.metrics?.lookups.inc({owner: this.owner, operation: "deserialize", result: hit ? "hit" : "miss"});
    if (hit) return cached;
    const {block} = deserializeBlock(this.config, blockRoot, bytes, fork, this.opts.serializedCache);
    return this.set(blockRoot, block, bytes);
  }

  /** Only remove the matching object when another candidate may have replaced it. */
  delete(blockRoot: RootHex, block?: SignedBeaconBlock, reason: BlockSerializedCacheDeleteReason = "explicit"): void {
    const cached = this.entries.get(blockRoot);
    if (!cached) {
      this.opts.metrics?.deleteMisses.inc({owner: this.owner, reason, result: "missing"});
    } else if (block !== undefined && cached.block !== block) {
      this.opts.metrics?.deleteMisses.inc({owner: this.owner, reason, result: "object_mismatch"});
      this.opts.logger?.debug("Skipped block cache deletion for a different block object", {
        owner: this.owner,
        reason,
        root: blockRoot,
        slot: block.message.slot,
      });
    } else {
      this.entries.delete(blockRoot);
      this.opts.metrics?.removals.inc({owner: this.owner, reason});
    }
  }

  prune(finalizedSlot: Slot): void {
    let removed = 0;
    for (const [root, {block}] of this.entries) {
      if (block.message.slot < finalizedSlot) {
        this.entries.delete(root);
        removed++;
      }
    }
    if (removed > 0) {
      this.opts.metrics?.removals.inc({owner: this.owner, reason: "finalized"}, removed);
      this.opts.logger?.debug("Pruned block cache", {
        owner: this.owner,
        reason: "finalized",
        removed,
        size: this.entries.size,
        finalizedSlot,
      });
    }
  }
}

export function deserializeBlock(
  config: ChainForkConfig,
  blockRoot: RootHex,
  bytes: Uint8Array,
  fork?: ForkName,
  serializedCache?: SerializedCache
): BlockSerializedCacheEntry {
  const slot = getSlotFromSignedBeaconBlockSerialized(bytes);
  if (slot === null) throw new LodestarError({code: "INVALID_BLOCK_SSZ"});
  const types = fork === undefined ? config.getForkTypes(slot) : sszTypesFor(fork);
  let block: SignedBeaconBlock;
  try {
    // Bitlist decoding clears padding bits; preserve the bytes retained for import and persistence.
    // TODO - beacon engine: revisit reuseBytes after https://github.com/ChainSafe/ssz/issues/559 is fixed.
    block =
      serializedCache?.getDeserialized<SignedBeaconBlock>(bytes) ??
      types.SignedBeaconBlock.deserialize(bytes, {reuseBytes: false});
  } catch (error) {
    throw new LodestarError({code: "INVALID_BLOCK_SSZ"}, (error as Error).message);
  }
  const actualRoot = toRootHex(types.BeaconBlock.hashTreeRoot(block.message));
  if (actualRoot !== blockRoot) {
    throw new LodestarError({code: "BLOCK_ROOT_MISMATCH", blockRoot, actualRoot});
  }
  return {block, bytes};
}
