import {phase0} from "@chainsafe/lodestar-types";
import {BeaconStateCachedPhase0, BeaconStateCachedAllForks} from "../../types";
import {processBlockHeader, processEth1Data, processRandao} from "../../allForks/block";
import {processOperations} from "./processOperations";
import {processAttestation, validateAttestation} from "./processAttestation";
import {processDeposit} from "./processDeposit";
import {processAttesterSlashing} from "./processAttesterSlashing";
import {processProposerSlashing} from "./processProposerSlashing";
import {processVoluntaryExit} from "./processVoluntaryExit";

// Extra utils used by other modules
export {isValidIndexedAttestation} from "../../allForks/block";

export {
  processOperations,
  validateAttestation,
  processAttestation,
  processDeposit,
  processAttesterSlashing,
  processProposerSlashing,
  processVoluntaryExit,
};

export function processBlock(state: BeaconStateCachedPhase0, block: phase0.BeaconBlock, verifySignatures = true): void {
  processBlockHeader(state as BeaconStateCachedAllForks, block);
  processRandao(state as BeaconStateCachedAllForks, block, verifySignatures);
  processEth1Data(state as BeaconStateCachedAllForks, block.body);
  processOperations(state, block.body, verifySignatures);
}
