import {Root, phase0, Slot} from "@chainsafe/lodestar-types";

export interface IBeaconBlocksApi {
  getBlockHeaders(filters: Partial<{slot: Slot; parentRoot: Root}>): Promise<phase0.SignedBeaconHeaderResponse[]>;
  getBlockHeader(blockId: BlockId): Promise<phase0.SignedBeaconHeaderResponse | null>;
  getBlock(blockId: BlockId): Promise<phase0.SignedBeaconBlock | null>;
  publishBlock(block: phase0.SignedBeaconBlock): Promise<void>;
}

export type BlockId = string | "head" | "genesis" | "finalized";
