import {phase0} from "@chainsafe/lodestar-types";
import {CachedBeaconStatePhase0} from "../../types.js";
import {processBlockHeader, processEth1Data, processRandao} from "../../allForks/block/index.js";
import {processOperations} from "./processOperations.js";
import {processAttestation, validateAttestation} from "./processAttestation.js";
import {processDeposit} from "./processDeposit.js";
import {processAttesterSlashing} from "./processAttesterSlashing.js";
import {processProposerSlashing} from "./processProposerSlashing.js";
import {processVoluntaryExit} from "./processVoluntaryExit.js";

// Extra utils used by other modules
export {isValidIndexedAttestation} from "../../allForks/block/index.js";

export {
  processOperations,
  validateAttestation,
  processAttestation,
  processDeposit,
  processAttesterSlashing,
  processProposerSlashing,
  processVoluntaryExit,
};

export function processBlock(state: CachedBeaconStatePhase0, block: phase0.BeaconBlock, verifySignatures = true): void {
  processBlockHeader(state, block);
  processRandao(state, block, verifySignatures);
  processEth1Data(state, block.body.eth1Data);
  processOperations(state, block.body, verifySignatures);
}
