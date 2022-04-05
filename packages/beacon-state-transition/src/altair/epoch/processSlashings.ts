import {ForkName} from "@chainsafe/lodestar-params";
import {CachedBeaconStateAltair, EpochProcess} from "../../types";
import {processSlashingsAllForks} from "../../allForks/epoch/processSlashings";

export function processSlashings(state: CachedBeaconStateAltair, epochProcess: EpochProcess): void {
  processSlashingsAllForks(ForkName.altair, state, epochProcess);
}
