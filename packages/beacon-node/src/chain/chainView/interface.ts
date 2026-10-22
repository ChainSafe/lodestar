import {CheckpointWithHex, PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";
import {Root, RootHex, Slot} from "@lodestar/types";
import {BlockRootSlot} from "../../util/sszBytes.js";

export type ChainViewBlock<TRoot = RootHex> = Pick<ProtoBlock, "slot" | "payloadStatus"> & {
  blockRoot: TRoot;
  parentRoot: TRoot;
  stateRoot: TRoot;
  parentBlockHash: TRoot | null;
  executionPayloadBlockHash: TRoot | null;
  executionPayloadNumber?: number;
};

export type ChainViewState = {
  head: ChainViewBlock;
  justified: CheckpointWithHex;
  finalized: CheckpointWithHex;
};

export type ChainViewSnapshot = ChainViewState & {
  blocks: ChainViewBlock[];
};

export interface IChainView {
  getHead(): ChainViewBlock;
  getHeadRoot(): RootHex;
  getFinalizedCheckpoint(): CheckpointWithHex;
  getJustifiedCheckpoint(): CheckpointWithHex;
  getFinalizedBlock(): ChainViewBlock;
  getJustifiedBlock(): ChainViewBlock;
  hasBlock(root: Root): boolean;
  hasBlockHex(root: RootHex): boolean;
  hasBlockHexUnsafe(root: RootHex): boolean;
  hasPayloadHexUnsafe(root: RootHex): boolean;
  getBlockDefaultStatus(root: Root): ChainViewBlock | null;
  getBlockHexDefaultStatus(root: RootHex): ChainViewBlock | null;
  getBlockHex(root: RootHex, status: PayloadStatus): ChainViewBlock | null;
  getBlockHexAndBlockHash(root: RootHex, hash: RootHex): ChainViewBlock | null;
  getCanonicalProtoBlockAtSlot(slot: Slot): ChainViewBlock | null;
  getCanonicalBlockClosestLteSlot(slot: Slot): ChainViewBlock | null;
  getCanonicalBlockByRoot(root: Root): ChainViewBlock | null;
  getBlockSummariesAtSlot(slot: Slot): ChainViewBlock[];
  getBlockSummariesByParentRoot(root: RootHex): ChainViewBlock[];
  isDescendant(root: RootHex, status: PayloadStatus, descendantRoot: RootHex, descendantStatus: PayloadStatus): boolean;
  getAllAncestorBlocks(root: RootHex, status: PayloadStatus): ChainViewBlock[];
  getCanonicalBlockRootSlotsByRange(
    startSlot: Slot,
    endSlot: Slot
  ): {finalizedSlot: Slot; nonFinalized: BlockRootSlot[]};
  getFullBlockRootSlotsByRange(startSlot: Slot, endSlot: Slot): {finalizedSlot: Slot; nonFinalized: BlockRootSlot[]};
}
