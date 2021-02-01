import {Root, SignedBeaconHeaderResponse, Slot} from "@chainsafe/lodestar-types";
import {SignedBeaconBlockType} from "@chainsafe/lodestar-core";

export interface IBeaconBlocksApi {
  getBlockHeaders(filters: Partial<{slot: Slot; parentRoot: Root}>): Promise<SignedBeaconHeaderResponse[]>;
  getBlockHeader(blockId: BlockId): Promise<SignedBeaconHeaderResponse | null>;
  getBlock(blockId: BlockId): Promise<SignedBeaconBlockType | null>;
  publishBlock(block: SignedBeaconBlockType): Promise<void>;
}

export type BlockId = string | "head" | "genesis" | "finalized";
