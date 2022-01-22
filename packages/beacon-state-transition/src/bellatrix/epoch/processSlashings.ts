import {ForkName} from "@chainsafe/lodestar-params";
import {CachedBeaconStateBellatrix, CachedBeaconStateAllForks, IEpochProcess} from "../../types";
import {processSlashingsAllForks} from "../../allForks/epoch/processSlashings";

export function processSlashings(state: CachedBeaconStateBellatrix, epochProcess: IEpochProcess): void {
  processSlashingsAllForks(ForkName.bellatrix, state as CachedBeaconStateAllForks, epochProcess);
}
