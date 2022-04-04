import {phase0} from "@chainsafe/lodestar-types";
import {CachedBeaconStatePhase0} from "../../types";
import {processVoluntaryExitAllForks} from "../../allForks/block";

export function processVoluntaryExit(
  state: CachedBeaconStatePhase0,
  signedVoluntaryExit: phase0.SignedVoluntaryExit,
  verifySignature = true
): void {
  processVoluntaryExitAllForks(state, signedVoluntaryExit, verifySignature);
}
