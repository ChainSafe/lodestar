import {CachedBeaconState} from "../util";
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
export {isValidIndexedAttestation, getIndexedAttestationSignatureSet} from "./isValidIndexedAttestation";
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
  state: CachedBeaconState<phase0.BeaconState>,
  block: phase0.BeaconBlock,
  verifySignatures = true
): void {
  processBlockHeader(state, block);
  processRandao(state, block, verifySignatures);
  processEth1Data(state, block.body);
  processOperations(state, block.body, verifySignatures);
}
