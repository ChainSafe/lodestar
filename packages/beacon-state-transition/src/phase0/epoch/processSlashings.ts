import {ForkName} from "@chainsafe/lodestar-params";
import {CachedBeaconStatePhase0, EpochProcess} from "../../types.js";
import {processSlashingsAllForks} from "../../allForks/epoch/processSlashings.js";

export function processSlashings(state: CachedBeaconStatePhase0, epochProcess: EpochProcess): void {
  processSlashingsAllForks(ForkName.phase0, state, epochProcess);
}
