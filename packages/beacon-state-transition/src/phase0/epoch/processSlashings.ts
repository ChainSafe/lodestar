import {ForkName} from "@chainsafe/lodestar-params";
import {BeaconStateCachedPhase0, BeaconStateCachedAllForks, IEpochProcess} from "../../allForks/util";
import {processSlashingsAllForks} from "../../allForks/epoch/processSlashings";

export function processSlashings(state: BeaconStateCachedPhase0, epochProcess: IEpochProcess): void {
  processSlashingsAllForks(ForkName.phase0, state as BeaconStateCachedAllForks, epochProcess);
}
