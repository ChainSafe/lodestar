import {phase0} from "@chainsafe/lodestar-types";
import {IRegularSyncModules} from "../..";

export interface IBlockRangeFetcher {
  setLastProcessedBlock(lastProcessedBlock: phase0.SlotRoot): void;
  getNextBlockRange(): Promise<phase0.SignedBeaconBlock[]>;
}

export type ORARegularSyncModules = IRegularSyncModules & {
  fetcher?: IBlockRangeFetcher;
};
