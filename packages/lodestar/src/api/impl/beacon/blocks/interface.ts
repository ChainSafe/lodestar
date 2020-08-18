import {Root, SignedBeaconBlock, SignedBeaconHeaderResponse, Slot} from "@chainsafe/lodestar-types";

export interface IBeaconBlocksApi {
  getBlockHeaders(filters: Partial<{slot: Slot; parentRoot: Root}>): Promise<SignedBeaconHeaderResponse[]>;
  getBlockHeader(blockId: BlockId): Promise<SignedBeaconHeaderResponse|null>;
  getBlock(blockId: BlockId): Promise<SignedBeaconBlock|null>;
}

export type BlockId = string|"head"|"genesis"|"finalized";
