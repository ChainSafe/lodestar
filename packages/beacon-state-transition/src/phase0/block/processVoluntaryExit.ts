import {allForks, phase0} from "@chainsafe/lodestar-types";
import {CachedBeaconState} from "../../allForks/util";
import {processVoluntaryExitAllForks} from "../../allForks/block";

export function processVoluntaryExit(
  state: CachedBeaconState<phase0.BeaconState>,
  signedVoluntaryExit: phase0.SignedVoluntaryExit,
  verifySignature = true
): void {
  processVoluntaryExitAllForks(state as CachedBeaconState<allForks.BeaconState>, signedVoluntaryExit, verifySignature);
}
