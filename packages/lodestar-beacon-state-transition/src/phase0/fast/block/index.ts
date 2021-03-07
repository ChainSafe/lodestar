import {EpochContext, CachedValidatorsBeaconState} from "../util";
import {phase0} from "@chainsafe/lodestar-types";

import {processBlockHeader} from "./processBlockHeader";
import {processRandao} from "./processRandao";
import {processEth1Data} from "./processEth1Data";
import {processOperations} from "./processOperations";
import {processAttestation} from "./processAttestation";
import {processAttesterSlashing} from "./processAttesterSlashing";
import {processDeposit} from "./processDeposit";
import {processProposerSlashing} from "./processProposerSlashing";
import {processVoluntaryExit} from "./processVoluntaryExit";

// Extra utils used by other modules
export {isValidIndexedAttestation} from "./isValidIndexedAttestation";
export {getNewEth1Data} from "./processEth1Data";

export {
  processBlockHeader,
  processRandao,
  processEth1Data,
  processOperations,
  processAttestation,
  processAttesterSlashing,
  processDeposit,
  processProposerSlashing,
  processVoluntaryExit,
};

export function processBlock(
  epochCtx: EpochContext,
  state: CachedValidatorsBeaconState,
  block: phase0.BeaconBlock,
  verifySignatures = true
): void {
  processBlockHeader(epochCtx, state, block);
  processRandao(epochCtx, state, block, verifySignatures);
  processEth1Data(epochCtx, state, block.body);
  processOperations(epochCtx, state, block.body, verifySignatures);
}
