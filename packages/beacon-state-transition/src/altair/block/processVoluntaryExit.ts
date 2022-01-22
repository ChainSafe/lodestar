import {phase0} from "@chainsafe/lodestar-types";
import {CachedBeaconStateAltair, CachedBeaconStateAllForks} from "../../types";
import {processVoluntaryExitAllForks} from "../../allForks/block";

export function processVoluntaryExit(
  state: CachedBeaconStateAltair,
  signedVoluntaryExit: phase0.SignedVoluntaryExit,
  verifySignature = true
): void {
  processVoluntaryExitAllForks(state as CachedBeaconStateAllForks, signedVoluntaryExit, verifySignature);
}
