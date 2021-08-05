import {allForks, phase0} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";
import {CachedBeaconState, IEpochProcess} from "../../allForks/util";
import {processSlashingsAllForks} from "../../allForks/epoch/processSlashings";

export function processSlashings(state: CachedBeaconState<phase0.BeaconState>, epochProcess: IEpochProcess): void {
  processSlashingsAllForks(ForkName.phase0, state as CachedBeaconState<allForks.BeaconState>, epochProcess);
}
