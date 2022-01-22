import {phase0} from "@chainsafe/lodestar-types";
import {BeaconStateCachedAltair, BeaconStateCachedAllForks} from "../../types";
import {processVoluntaryExitAllForks} from "../../allForks/block";

export function processVoluntaryExit(
  state: BeaconStateCachedAltair,
  signedVoluntaryExit: phase0.SignedVoluntaryExit,
  verifySignature = true
): void {
  processVoluntaryExitAllForks(state as BeaconStateCachedAllForks, signedVoluntaryExit, verifySignature);
}
