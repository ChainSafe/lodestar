import {phase0} from "@chainsafe/lodestar-types";
import {CachedBeaconStateAltair} from "../../types.js";
import {processVoluntaryExitAllForks} from "../../allForks/block/index.js";

export function processVoluntaryExit(
  state: CachedBeaconStateAltair,
  signedVoluntaryExit: phase0.SignedVoluntaryExit,
  verifySignature = true
): void {
  processVoluntaryExitAllForks(state, signedVoluntaryExit, verifySignature);
}
