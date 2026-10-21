import {ChainForkConfig} from "@lodestar/config";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {SignedBeaconBlock, Slot, sszTypesFor} from "@lodestar/types";
import {LodestarError, Logger, byteArrayEquals, pruneSetToMax} from "@lodestar/utils";
import type {Metrics} from "../../metrics/index.js";
import {MAX_LOOK_AHEAD_EPOCHS} from "../../sync/constants.js";
import {SerializedCache} from "../../util/serializedCache.js";
import {getSlotFromSignedBeaconBlockSerialized} from "../../util/sszBytes.js";
import {SignedBlockRoot, SignedBlockRootHex, computeSignedBlockRoot, toSignedBlockRootHex} from "./signedBlockRoot.js";

/** Validation and processing identify the exact signed candidate across the engine boundary. */
export type BlockBytes = {signedBlockRoot: SignedBlockRoot; blockBytes: Uint8Array};
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
 * Bounded reuse of decoded blocks and bytes by signed block root, without implying validation.
 * Owned by BeaconEngineCore for gossip validation and block processing only.
 * Different signatures for one unsigned message root have independent entries and cleanup.
 * Each signed candidate counts toward the capacity bound, including candidates for the same message.
 * Entries may be removed on rejection, persistence, finalization or capacity eviction.
 * BeaconEngineCore.verifiedBlocks independently retains the exact block/bytes references needed for
 * pending imports under the same signed root, so removal here cannot invalidate an import.
 * Callers must derive roots from the block and keep cached blocks and bytes immutable.
 */
export class BlockSerializedCache {
  private readonly entries = new Map<SignedBlockRootHex, BlockSerializedCacheEntry>();
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

  get(signedBlockRootHex: SignedBlockRootHex): BlockSerializedCacheEntry | undefined {
    const entry = this.entries.get(signedBlockRootHex);
    this.opts.metrics?.lookups.inc({owner: this.owner, operation: "get", result: entry ? "hit" : "miss"});
    return entry;
  }

  /** The caller must derive the signed root from this block, and the bytes must encode this block. */
  set(signedBlockRootHex: SignedBlockRootHex, block: SignedBeaconBlock, bytes: Uint8Array): BlockSerializedCacheEntry {
    const cached = this.entries.get(signedBlockRootHex);
    if (cached && (cached.bytes === bytes || byteArrayEquals(cached.bytes, bytes))) return cached;
    const entry = {block, bytes};
    if (cached) this.opts.metrics?.removals.inc({owner: this.owner, reason: "replaced"});
    this.entries.delete(signedBlockRootHex);
    this.entries.set(signedBlockRootHex, entry);
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

  getOrSerialize(signedBlockRootHex: SignedBlockRootHex, block: SignedBeaconBlock): BlockSerializedCacheEntry {
    const cached = this.entries.get(signedBlockRootHex);
    const hit = cached !== undefined;
    this.opts.metrics?.lookups.inc({owner: this.owner, operation: "serialize", result: hit ? "hit" : "miss"});
    if (hit) return cached;
    return this.set(
      signedBlockRootHex,
      block,
      this.config.getForkTypes(block.message.slot).SignedBeaconBlock.serialize(block)
    );
  }

  /**
   * Reuse only exact bytes for the supplied signed root. On a miss, decode and verify the full
   * SignedBeaconBlock.hashTreeRoot() before insertion, so a claimed key cannot poison the cache.
   */
  getOrDeserialize(signedBlockRoot: SignedBlockRoot, bytes: Uint8Array, fork?: ForkName): BlockSerializedCacheEntry {
    if (signedBlockRoot.length !== 32) throw new LodestarError({code: "SIGNED_BLOCK_ROOT_MISMATCH"});
    const signedBlockRootHex = toSignedBlockRootHex(signedBlockRoot);
    const cached = this.entries.get(signedBlockRootHex);
    const hit = cached && (cached.bytes === bytes || byteArrayEquals(cached.bytes, bytes));
    this.opts.metrics?.lookups.inc({owner: this.owner, operation: "deserialize", result: hit ? "hit" : "miss"});
    if (hit) return cached;
    const {block} = deserializeBlock(this.config, signedBlockRoot, bytes, fork, this.opts.serializedCache);
    return this.set(signedBlockRootHex, block, bytes);
  }

  /** If supplied, block must be the exact cached object. */
  delete(
    signedBlockRootHex: SignedBlockRootHex,
    block?: SignedBeaconBlock,
    reason: BlockSerializedCacheDeleteReason = "explicit"
  ): void {
    const cached = this.entries.get(signedBlockRootHex);
    if (!cached) {
      this.opts.metrics?.deleteMisses.inc({owner: this.owner, reason, result: "missing"});
    } else if (block !== undefined && cached.block !== block) {
      this.opts.metrics?.deleteMisses.inc({owner: this.owner, reason, result: "object_mismatch"});
      this.opts.logger?.debug("Skipped block cache deletion for a different block object", {
        owner: this.owner,
        reason,
        signedBlockRootHex,
        slot: block.message.slot,
      });
    } else {
      this.entries.delete(signedBlockRootHex);
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
  signedBlockRoot: SignedBlockRoot,
  bytes: Uint8Array,
  fork?: ForkName,
  serializedCache?: SerializedCache
): BlockSerializedCacheEntry {
  if (signedBlockRoot.length !== 32) throw new LodestarError({code: "SIGNED_BLOCK_ROOT_MISMATCH"});
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
  const actualRoot = computeSignedBlockRoot(fork ?? config.getForkName(slot), block);
  if (!byteArrayEquals(actualRoot, signedBlockRoot)) {
    throw new LodestarError({
      code: "SIGNED_BLOCK_ROOT_MISMATCH",
      signedBlockRoot: toSignedBlockRootHex(signedBlockRoot),
      actualRoot: toSignedBlockRootHex(actualRoot),
    });
  }
  return {block, bytes};
}
