import {allForks, altair, phase0} from "@chainsafe/lodestar-types";
import {CachedBeaconState} from "../../allForks";
import {processVoluntaryExitAllForks} from "../../allForks/block";
import {BlockProcess} from "../../util/blockProcess";

export function processVoluntaryExit(
  state: CachedBeaconState<altair.BeaconState>,
  signedVoluntaryExit: phase0.SignedVoluntaryExit,
  blockProcess: BlockProcess,
  verifySignature = true
): void {
  processVoluntaryExitAllForks(
    state as CachedBeaconState<allForks.BeaconState>,
    signedVoluntaryExit,
    blockProcess,
    verifySignature
  );
}
