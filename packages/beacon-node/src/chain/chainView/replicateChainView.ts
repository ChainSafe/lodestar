import {CheckpointWithHex, PayloadStatus} from "@lodestar/fork-choice";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Root, RootHex, Slot} from "@lodestar/types";
import {LodestarError, Logger, toRootHex} from "@lodestar/utils";
import {ChainViewBlock, ChainViewSnapshot, ChainViewState, ChainViewUpdate, IChainView} from "./interface.js";
import {getCanonicalBlockRootSlotsByRange, getFullBlockRootSlotsByRange} from "./utils.js";

export enum ChainViewErrorCode {
  UNKNOWN_BLOCK = "CHAIN_VIEW_UNKNOWN_BLOCK",
}

export class ChainViewError extends LodestarError<{code: ChainViewErrorCode.UNKNOWN_BLOCK; root: RootHex}> {}

/** Replicated imported-block metadata. Canonical ancestry is derived from the shared head. */
export class ReplicateChainView implements IChainView {
  private readonly blocks = new Map<RootHex, Partial<Record<PayloadStatus, ChainViewBlock>>>();
  private state: ChainViewState;
  private prunedCheckpoint?: CheckpointWithHex;
  private readonly finalizedDescendants = new Map<RootHex, boolean>();
  version: number;

  constructor(
    snapshot: ChainViewSnapshot,
    private readonly logger?: Logger
  ) {
    this.state = {head: snapshot.head, justified: snapshot.justified, finalized: snapshot.finalized};
    this.version = snapshot.version;
    this.mergeBlocks(snapshot.blocks);
  }

  onChainViewUpdate(update: ChainViewUpdate): boolean {
    const {blocks, version} = update;
    const stale = version !== undefined && version < this.version;
    // Blocks are additive; a stale state must not roll the replica back
    const state = stale ? undefined : update.state;
    if (
      state &&
      (state.finalized.epoch !== this.state.finalized.epoch || state.finalized.rootHex !== this.state.finalized.rootHex)
    ) {
      this.finalizedDescendants.clear();
    }
    this.mergeBlocks(blocks);
    if (state) this.state = {head: state.head, justified: state.justified, finalized: state.finalized};
    if (version !== undefined && version > this.version) this.version = version;
    return !stale;
  }

  applyFinalizedCheckpoint(checkpoint: CheckpointWithHex): void {
    if (checkpoint.epoch <= this.state.finalized.epoch) return;
    this.finalizedDescendants.clear();
    this.state = {
      ...this.state,
      finalized: {epoch: checkpoint.epoch, root: checkpoint.root, rootHex: checkpoint.rootHex},
    };
  }

  prune(finalized: CheckpointWithHex): void {
    if (this.prunedCheckpoint && finalized.epoch <= this.prunedCheckpoint.epoch) return;
    const boundary = this.blocks.get(finalized.rootHex);
    if (!boundary) throw new ChainViewError({code: ChainViewErrorCode.UNKNOWN_BLOCK, root: finalized.rootHex});
    const previousSize = this.blocks.size;
    const retained = new Set<RootHex>([finalized.rootHex]);
    const blocks = this.getBlocks().sort((a, b) => a.slot - b.slot);
    for (const block of blocks) {
      if (retained.has(block.parentRoot)) retained.add(block.blockRoot);
    }
    for (const root of this.blocks.keys()) {
      if (!retained.has(root)) this.blocks.delete(root);
    }
    this.finalizedDescendants.clear();
    this.prunedCheckpoint = finalized;
    this.logger?.debug("Pruned ChainView", {
      finalizedEpoch: finalized.epoch,
      finalizedRoot: finalized.rootHex,
      prunedRoots: previousSize - this.blocks.size,
      retainedRoots: this.blocks.size,
    });
  }

  getHead(): ChainViewBlock {
    return this.state.head;
  }
  getHeadRoot(): RootHex {
    return this.state.head.blockRoot;
  }
  getFinalizedCheckpoint(): CheckpointWithHex {
    return this.state.finalized;
  }
  getJustifiedCheckpoint(): CheckpointWithHex {
    return this.state.justified;
  }
  getFinalizedBlock(): ChainViewBlock {
    return this.requireBlock(this.state.finalized.rootHex);
  }
  getJustifiedBlock(): ChainViewBlock {
    return this.requireBlock(this.state.justified.rootHex);
  }
  hasBlock(root: Root): boolean {
    return this.hasBlockHex(toRootHex(root));
  }
  hasBlockHex(root: RootHex): boolean {
    return this.getBlockHexDefaultStatus(root) !== null;
  }
  hasBlockHexUnsafe(root: RootHex): boolean {
    return this.blocks.has(root);
  }
  hasPayloadHexUnsafe(root: RootHex): boolean {
    return this.blocks.get(root)?.[PayloadStatus.FULL] !== undefined;
  }
  getBlockDefaultStatus(root: Root): ChainViewBlock | null {
    return this.getBlockHexDefaultStatus(toRootHex(root));
  }

  getBlockHexDefaultStatus(root: RootHex): ChainViewBlock | null {
    const variants = this.blocks.get(root);
    return this.getBlockHex(root, variants?.[PayloadStatus.PENDING] ? PayloadStatus.PENDING : PayloadStatus.FULL);
  }

  getBlockHex(root: RootHex, status: PayloadStatus): ChainViewBlock | null {
    const block = this.blocks.get(root)?.[status];
    return block && this.isFinalizedDescendant(block) ? block : null;
  }

  getBlockHexAndBlockHash(root: RootHex, hash: RootHex): ChainViewBlock | null {
    const variants = this.blocks.get(root);
    for (const status of [PayloadStatus.FULL, PayloadStatus.EMPTY]) {
      const block = variants?.[status];
      if (block?.executionPayloadBlockHash === hash) return block;
    }
    return null;
  }

  getCanonicalProtoBlockAtSlot(slot: Slot): ChainViewBlock | null {
    if (slot === this.state.head.slot) return this.getHead();
    for (const block of this.iterateAncestorBlocks(this.state.head.blockRoot, this.state.head.payloadStatus)) {
      if (block.slot === slot) return block;
      if (block.slot < slot) break;
    }
    return null;
  }

  getCanonicalBlockClosestLteSlot(slot: Slot): ChainViewBlock | null {
    if (slot >= this.state.head.slot) return this.getHead();
    for (const block of this.iterateAncestorBlocks(this.state.head.blockRoot, this.state.head.payloadStatus)) {
      if (block.slot <= slot) return block;
    }
    return null;
  }

  getCanonicalBlockByRoot(root: Root): ChainViewBlock | null {
    const rootHex = toRootHex(root);
    if (rootHex === this.state.head.blockRoot) return this.getHead();
    for (const block of this.iterateAncestorBlocks(this.state.head.blockRoot, this.state.head.payloadStatus)) {
      if (block.blockRoot === rootHex) return block;
    }
    return null;
  }

  getBlockSummariesAtSlot(slot: Slot): ChainViewBlock[] {
    return this.getBlocks().filter(
      (block) =>
        block.slot === slot && (block.parentBlockHash === null || block.payloadStatus === PayloadStatus.PENDING)
    );
  }

  getBlockSummariesByParentRoot(root: RootHex): ChainViewBlock[] {
    return this.getBlocks().filter(
      (block) =>
        block.parentRoot === root && (block.parentBlockHash === null || block.payloadStatus === PayloadStatus.PENDING)
    );
  }

  isDescendant(
    root: RootHex,
    status: PayloadStatus,
    descendantRoot: RootHex,
    descendantStatus: PayloadStatus
  ): boolean {
    const ancestor = this.blocks.get(root)?.[status];
    if (!ancestor) return false;
    for (const block of this.iterateAncestorBlocks(descendantRoot, descendantStatus)) {
      if (block.blockRoot === root) {
        return block.payloadStatus === status || status === PayloadStatus.PENDING;
      }
      if (block.slot <= ancestor.slot) return false;
    }
    return false;
  }

  getAllAncestorBlocks(root: RootHex, status: PayloadStatus): ChainViewBlock[] {
    return Array.from(this.iterateAncestorBlocks(root, status)).filter(
      (block) => block.payloadStatus !== PayloadStatus.PENDING
    );
  }

  private *iterateAncestorBlocks(root: RootHex, status: PayloadStatus): IterableIterator<ChainViewBlock> {
    let block = this.blocks.get(root)?.[status];
    while (block) {
      yield block;
      const parent: ChainViewBlock | null | undefined =
        block.parentBlockHash === null
          ? this.blocks.get(block.parentRoot)?.[PayloadStatus.FULL]
          : this.getBlockHexAndBlockHash(block.parentRoot, block.parentBlockHash);
      if (parent && parent.slot >= block.slot) break;
      block = parent ?? undefined;
    }
  }

  getCanonicalBlockRootSlotsByRange(startSlot: Slot, endSlot: Slot) {
    return getCanonicalBlockRootSlotsByRange(this, startSlot, endSlot);
  }

  getFullBlockRootSlotsByRange(startSlot: Slot, endSlot: Slot) {
    return getFullBlockRootSlotsByRange(this, startSlot, endSlot);
  }

  private mergeBlocks(blocks: ChainViewBlock[]): void {
    // TODO - beacon engine: pull a snapshot when a response references ancestry missing from ChainView.
    // A batch may contain late updates for nodes the engine has not pruned yet.
    for (const block of this.prunedCheckpoint ? [...blocks].sort((a, b) => a.slot - b.slot) : blocks) {
      if (
        this.prunedCheckpoint &&
        block.blockRoot !== this.prunedCheckpoint.rootHex &&
        !this.blocks.has(block.parentRoot)
      )
        continue;
      let variants = this.blocks.get(block.blockRoot);
      if (!variants) {
        variants = {};
        this.blocks.set(block.blockRoot, variants);
      }
      variants[block.payloadStatus] = block;
      if (block.payloadStatus === PayloadStatus.PENDING) {
        // Gloas block import creates PENDING and EMPTY with identical structural metadata.
        variants[PayloadStatus.EMPTY] ??= {...block, payloadStatus: PayloadStatus.EMPTY};
      }
    }
  }

  private getBlocks(): ChainViewBlock[] {
    return Array.from(this.blocks.values()).flatMap((variants) => Object.values(variants));
  }

  private requireBlock(root: RootHex): ChainViewBlock {
    const block = this.getBlockHexDefaultStatus(root);
    if (!block) throw new ChainViewError({code: ChainViewErrorCode.UNKNOWN_BLOCK, root});
    return block;
  }

  private isFinalizedDescendant(block: ChainViewBlock): boolean {
    const finalized = this.state.finalized;
    if (finalized.epoch === 0) return true;
    const cached = this.finalizedDescendants.get(block.blockRoot);
    if (cached !== undefined) return cached;
    const path: RootHex[] = [];
    let descendant: boolean | undefined;
    for (const ancestor of this.iterateAncestorBlocks(block.blockRoot, block.payloadStatus)) {
      const known = this.finalizedDescendants.get(ancestor.blockRoot);
      if (known !== undefined) {
        descendant = known;
        break;
      }
      path.push(ancestor.blockRoot);
      if (ancestor.slot <= computeStartSlotAtEpoch(finalized.epoch)) {
        descendant = ancestor.blockRoot === finalized.rootHex;
        break;
      }
    }
    // Missing ancestry may arrive in a later response, so only cache a resolved walk.
    if (descendant === undefined) return false;
    for (const root of path) this.finalizedDescendants.set(root, descendant);
    return descendant;
  }
}
