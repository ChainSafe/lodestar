import {allForks, bellatrix} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";
import {CachedBeaconState, IEpochProcess} from "../../allForks/util";
import {processSlashingsAllForks} from "../../allForks/epoch/processSlashings";

export function processSlashings(state: CachedBeaconState<bellatrix.BeaconState>, epochProcess: IEpochProcess): void {
  processSlashingsAllForks(ForkName.bellatrix, state as CachedBeaconState<allForks.BeaconState>, epochProcess);
}
