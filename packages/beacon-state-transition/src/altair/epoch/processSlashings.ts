import {ForkName} from "@chainsafe/lodestar-params";
import {CachedBeaconStateAltair, CachedBeaconStateAllForks, EpochProcess} from "../../types";
import {processSlashingsAllForks} from "../../allForks/epoch/processSlashings";

export function processSlashings(state: CachedBeaconStateAltair, epochProcess: EpochProcess): void {
  processSlashingsAllForks(ForkName.altair, state as CachedBeaconStateAllForks, epochProcess);
}
