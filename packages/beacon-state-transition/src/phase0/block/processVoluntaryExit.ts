import {phase0} from "@chainsafe/lodestar-types";
import {CachedBeaconStatePhase0, CachedBeaconStateAllForks} from "../../types";
import {processVoluntaryExitAllForks} from "../../allForks/block";

export function processVoluntaryExit(
  state: CachedBeaconStatePhase0,
  signedVoluntaryExit: phase0.SignedVoluntaryExit,
  verifySignature = true
): void {
  processVoluntaryExitAllForks(state as CachedBeaconStateAllForks, signedVoluntaryExit, verifySignature);
}
