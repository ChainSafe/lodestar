import {CheckpointWithHex, IForkChoice, PayloadStatus} from "@lodestar/fork-choice";
import {Root, RootHex, Slot} from "@lodestar/types";
import type {BeaconEngineCore} from "../beaconEngine/beaconEngineCore.js";
import {ChainViewBlock, IChainView} from "./interface.js";
import {getCanonicalBlockRootSlotsByRange, getFullBlockRootSlotsByRange} from "./utils.js";

/** Main-thread view: reads the in-process fork choice directly, so it is always current */
export class ForkChoiceChainView implements IChainView {
  constructor(private readonly core: BeaconEngineCore) {}

  get version(): number {
    return this.core.forkChoiceVersion;
  }

  private get forkChoice(): IForkChoice {
    return this.core.forkChoice;
  }

  getHead(): ChainViewBlock {
    return this.forkChoice.getHead();
  }
  getHeadRoot(): RootHex {
    return this.forkChoice.getHeadRoot();
  }
  getFinalizedCheckpoint(): CheckpointWithHex {
    return this.forkChoice.getFinalizedCheckpoint();
  }
  getJustifiedCheckpoint(): CheckpointWithHex {
    return this.forkChoice.getJustifiedCheckpoint();
  }
  getFinalizedBlock(): ChainViewBlock {
    return this.forkChoice.getFinalizedBlock();
  }
  getJustifiedBlock(): ChainViewBlock {
    return this.forkChoice.getJustifiedBlock();
  }
  hasBlock(root: Root): boolean {
    return this.forkChoice.hasBlock(root);
  }
  hasBlockHex(root: RootHex): boolean {
    return this.forkChoice.hasBlockHex(root);
  }
  hasBlockHexUnsafe(root: RootHex): boolean {
    return this.forkChoice.hasBlockHexUnsafe(root);
  }
  hasPayloadHexUnsafe(root: RootHex): boolean {
    return this.forkChoice.hasPayloadHexUnsafe(root);
  }
  getBlockDefaultStatus(root: Root): ChainViewBlock | null {
    return this.forkChoice.getBlockDefaultStatus(root);
  }
  getBlockHexDefaultStatus(root: RootHex): ChainViewBlock | null {
    return this.forkChoice.getBlockHexDefaultStatus(root);
  }
  getBlockHex(root: RootHex, status: PayloadStatus): ChainViewBlock | null {
    return this.forkChoice.getBlockHex(root, status);
  }
  getBlockHexAndBlockHash(root: RootHex, hash: RootHex): ChainViewBlock | null {
    return this.forkChoice.getBlockHexAndBlockHash(root, hash);
  }
  getCanonicalProtoBlockAtSlot(slot: Slot): ChainViewBlock | null {
    return this.forkChoice.getCanonicalBlockAtSlot(slot);
  }
  getCanonicalBlockClosestLteSlot(slot: Slot): ChainViewBlock | null {
    return this.forkChoice.getCanonicalBlockClosestLteSlot(slot);
  }
  getCanonicalBlockByRoot(root: Root): ChainViewBlock | null {
    return this.forkChoice.getCanonicalBlockByRoot(root);
  }
  getBlockSummariesAtSlot(slot: Slot): ChainViewBlock[] {
    return this.forkChoice.getBlockSummariesAtSlot(slot);
  }
  getBlockSummariesByParentRoot(root: RootHex): ChainViewBlock[] {
    return this.forkChoice.getBlockSummariesByParentRoot(root);
  }
  isDescendant(
    root: RootHex,
    status: PayloadStatus,
    descendantRoot: RootHex,
    descendantStatus: PayloadStatus
  ): boolean {
    return this.forkChoice.isDescendant(root, status, descendantRoot, descendantStatus);
  }
  getAllAncestorBlocks(root: RootHex, status: PayloadStatus): ChainViewBlock[] {
    return this.forkChoice.getAllAncestorBlocks(root, status);
  }
  getCanonicalBlockRootSlotsByRange(startSlot: Slot, endSlot: Slot) {
    return getCanonicalBlockRootSlotsByRange(this, startSlot, endSlot);
  }
  getFullBlockRootSlotsByRange(startSlot: Slot, endSlot: Slot) {
    return getFullBlockRootSlotsByRange(this, startSlot, endSlot);
  }
}
