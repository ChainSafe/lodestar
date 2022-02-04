import {ForkName} from "@chainsafe/lodestar-params";
import {CachedBeaconStatePhase0, CachedBeaconStateAllForks, IEpochProcess} from "../../types";
import {processSlashingsAllForks} from "../../allForks/epoch/processSlashings";

export function processSlashings(state: CachedBeaconStatePhase0, epochProcess: IEpochProcess): void {
  processSlashingsAllForks(ForkName.phase0, state as CachedBeaconStateAllForks, epochProcess);
}
