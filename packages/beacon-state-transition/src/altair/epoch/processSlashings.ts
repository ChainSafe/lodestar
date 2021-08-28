import {allForks, altair} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";
import {CachedBeaconState, IEpochProcess} from "../../allForks/util";
import {processSlashingsAllForks} from "../../allForks/epoch/processSlashings";

export function processSlashings(state: CachedBeaconState<altair.BeaconState>, epochProcess: IEpochProcess): void {
  processSlashingsAllForks(ForkName.altair, state as CachedBeaconState<allForks.BeaconState>, epochProcess);
}
