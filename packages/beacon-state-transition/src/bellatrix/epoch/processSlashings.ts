import {ForkName} from "@chainsafe/lodestar-params";
import {CachedBeaconStateBellatrix, CachedBeaconStateAllForks, EpochProcess} from "../../types.js";
import {processSlashingsAllForks} from "../../allForks/epoch/processSlashings.js";

export function processSlashings(state: CachedBeaconStateBellatrix, epochProcess: EpochProcess): void {
  processSlashingsAllForks(ForkName.bellatrix, state as CachedBeaconStateAllForks, epochProcess);
}
