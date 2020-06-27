import {Root, SignedBeaconHeaderResponse, Slot} from "@chainsafe/lodestar-types";

export interface IBeaconBlocksApi {
  getBlockHeaders(filters: Partial<{slot: Slot; parentRoot: Root}>): Promise<SignedBeaconHeaderResponse[]>;

  getBlockHeader(blockId: string): Promise<SignedBeaconHeaderResponse|null>;
}
