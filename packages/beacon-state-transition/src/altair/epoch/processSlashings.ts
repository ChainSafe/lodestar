import {ForkName} from "@chainsafe/lodestar-params";
import {CachedBeaconStateAltair, CachedBeaconStateAllForks, IEpochProcess} from "../../types";
import {processSlashingsAllForks} from "../../allForks/epoch/processSlashings";

export function processSlashings(state: CachedBeaconStateAltair, epochProcess: IEpochProcess): void {
  processSlashingsAllForks(ForkName.altair, state as CachedBeaconStateAllForks, epochProcess);
}
