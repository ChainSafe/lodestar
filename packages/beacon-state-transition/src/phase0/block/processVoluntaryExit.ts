import {phase0} from "@chainsafe/lodestar-types";
import {CachedBeaconStatePhase0} from "../../types.js";
import {processVoluntaryExitAllForks} from "../../allForks/block/index.js";

export function processVoluntaryExit(
  state: CachedBeaconStatePhase0,
  signedVoluntaryExit: phase0.SignedVoluntaryExit,
  verifySignature = true
): void {
  processVoluntaryExitAllForks(state, signedVoluntaryExit, verifySignature);
}
