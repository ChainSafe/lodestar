import {allForks, merge} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";
import {CachedBeaconState, IEpochProcess} from "../../allForks/util";
import {processSlashingsAllForks} from "../../allForks/epoch/processSlashings";

export function processSlashings(state: CachedBeaconState<merge.BeaconState>, epochProcess: IEpochProcess): void {
  processSlashingsAllForks(ForkName.merge, state as CachedBeaconState<allForks.BeaconState>, epochProcess);
}
