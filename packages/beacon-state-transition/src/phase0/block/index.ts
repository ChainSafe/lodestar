import {allForks, phase0} from "@chainsafe/lodestar-types";
import {CachedBeaconState} from "../../allForks/util";
import {processBlockHeader, processEth1Data, processRandao} from "../../allForks/block";
import {processOperations} from "./processOperations";
import {processAttestation} from "./processAttestation";
import {processDeposit} from "./processDeposit";
import {processAttesterSlashing, assertValidAttesterSlashing} from "./processAttesterSlashing";
import {processProposerSlashing, assertValidProposerSlashing} from "./processProposerSlashing";
import {processVoluntaryExit, assertValidVoluntaryExit} from "./processVoluntaryExit";

// Extra utils used by other modules
export {isValidIndexedAttestation} from "../../allForks/block";

export {
  processOperations,
  processAttestation,
  processDeposit,
  processAttesterSlashing,
  processProposerSlashing,
  processVoluntaryExit,
  // For Lodestar gossip validation
  assertValidAttesterSlashing,
  assertValidProposerSlashing,
  assertValidVoluntaryExit,
};

export function processBlock(
  state: CachedBeaconState<phase0.BeaconState>,
  block: phase0.BeaconBlock,
  verifySignatures = true
): void {
  processBlockHeader(state as CachedBeaconState<allForks.BeaconState>, block);
  processRandao(state as CachedBeaconState<allForks.BeaconState>, block, verifySignatures);
  processEth1Data(state as CachedBeaconState<allForks.BeaconState>, block.body);
  processOperations(state, block.body, verifySignatures);
}
