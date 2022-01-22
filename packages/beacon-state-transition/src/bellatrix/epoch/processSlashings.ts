import {ForkName} from "@chainsafe/lodestar-params";
import {BeaconStateCachedBellatrix, BeaconStateCachedAllForks, IEpochProcess} from "../../allForks/util";
import {processSlashingsAllForks} from "../../allForks/epoch/processSlashings";

export function processSlashings(state: BeaconStateCachedBellatrix, epochProcess: IEpochProcess): void {
  processSlashingsAllForks(ForkName.bellatrix, state as BeaconStateCachedAllForks, epochProcess);
}
