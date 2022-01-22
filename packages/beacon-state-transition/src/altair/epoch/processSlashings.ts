import {ForkName} from "@chainsafe/lodestar-params";
import {BeaconStateCachedAltair, BeaconStateCachedAllForks, IEpochProcess} from "../../allForks/util";
import {processSlashingsAllForks} from "../../allForks/epoch/processSlashings";

export function processSlashings(state: BeaconStateCachedAltair, epochProcess: IEpochProcess): void {
  processSlashingsAllForks(ForkName.altair, state as BeaconStateCachedAllForks, epochProcess);
}
