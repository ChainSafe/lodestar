import {CheckpointWithHex, PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";
import {Root, RootHex, Slot} from "@lodestar/types";
import {BlockRootSlot} from "../../util/sszBytes.js";

export type ChainViewBlock = Pick<
  ProtoBlock,
  | "blockRoot"
  | "slot"
  | "parentRoot"
  | "stateRoot"
  | "parentBlockHash"
  | "payloadStatus"
  | "executionPayloadBlockHash"
  | "dataAvailabilityStatus"
  | "finalizedEpoch"
  | "finalizedRoot"
> & {executionPayloadNumber?: number};

export type FinalizedProtoSummary = Pick<ChainViewBlock, "slot" | "blockRoot" | "payloadStatus">;

export type FinalizedBlockSnapshot = {
  canonical: FinalizedProtoSummary[];
  nonCanonical: FinalizedProtoSummary[];
};

export type ChainViewState = {
  head: ChainViewBlock;
  justified: CheckpointWithHex;
  finalized: CheckpointWithHex;
};

export type ChainViewSnapshot = ChainViewState & {
  revision: number;
  blocks: ChainViewBlock[];
};

/** Same payload shape as a snapshot, but blocks contains only changed metadata. */
export type ChainViewUpdate = ChainViewSnapshot;

export interface IChainView {
  getFinalizedBlockSnapshot(root: RootHex): FinalizedBlockSnapshot;
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
