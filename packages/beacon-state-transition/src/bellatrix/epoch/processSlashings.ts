import {ForkName} from "@chainsafe/lodestar-params";
import {CachedBeaconStateBellatrix, CachedBeaconStateAllForks, EpochProcess} from "../../types";
import {processSlashingsAllForks} from "../../allForks/epoch/processSlashings";

export function processSlashings(state: CachedBeaconStateBellatrix, epochProcess: EpochProcess): void {
  processSlashingsAllForks(ForkName.bellatrix, state as CachedBeaconStateAllForks, epochProcess);
}
