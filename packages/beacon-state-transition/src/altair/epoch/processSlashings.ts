import {ForkName} from "@chainsafe/lodestar-params";
import {CachedBeaconStateAltair, EpochProcess} from "../../types.js";
import {processSlashingsAllForks} from "../../allForks/epoch/processSlashings.js";

export function processSlashings(state: CachedBeaconStateAltair, epochProcess: EpochProcess): void {
  processSlashingsAllForks(ForkName.altair, state, epochProcess);
}
