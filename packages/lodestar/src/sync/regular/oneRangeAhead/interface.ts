import {SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {SlotRoot} from "@chainsafe/lodestar-types";
import {IRegularSyncModules} from "../..";

export interface IBlockRangeFetcher {
  setLastProcessedBlock(lastProcessedBlock: SlotRoot): void;
  getNextBlockRange(): Promise<SignedBeaconBlock[]>;
}

export type ORARegularSyncModules = IRegularSyncModules & {
  fetcher?: IBlockRangeFetcher;
};
