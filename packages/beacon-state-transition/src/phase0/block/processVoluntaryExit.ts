import {phase0} from "@chainsafe/lodestar-types";
import {BeaconStateCachedPhase0, BeaconStateCachedAllForks} from "../../allForks/util";
import {processVoluntaryExitAllForks} from "../../allForks/block";

export function processVoluntaryExit(
  state: BeaconStateCachedPhase0,
  signedVoluntaryExit: phase0.SignedVoluntaryExit,
  verifySignature = true
): void {
  processVoluntaryExitAllForks(state as BeaconStateCachedAllForks, signedVoluntaryExit, verifySignature);
}
