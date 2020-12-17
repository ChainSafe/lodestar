import {SlotRoot} from "@chainsafe/lodestar-types";

export interface IDebugBeaconApi {
  getHeads(): Promise<SlotRoot[] | null>;
}
