import {Root, phase0, allForks, Slot} from "@chainsafe/lodestar-types";

export interface IBeaconBlocksApi {
  getBlock(blockId: BlockId): Promise<allForks.SignedBeaconBlock>;
  getBlockHeaders(filters: Partial<{slot: Slot; parentRoot: Root}>): Promise<phase0.SignedBeaconHeaderResponse[]>;
  getBlockHeader(blockId: BlockId): Promise<phase0.SignedBeaconHeaderResponse>;
  getBlockRoot(blockId: BlockId): Promise<Root>;
  publishBlock(block: phase0.SignedBeaconBlock): Promise<void>;
}

export type BlockId = string | "head" | "genesis" | "finalized";
