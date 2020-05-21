import {EpochContext} from "../util";
import {BeaconBlock, BeaconState} from "@chainsafe/lodestar-types";

import {processBlockHeader} from "./processBlockHeader";
import {processRandao} from "./processRandao";
import {processEth1Data} from "./processEth1Data";
import {processOperations} from "./processOperations";
import {processAttestation} from "./processAttestation";
import {processAttesterSlashing} from "./processAttesterSlashing";
import {processDeposit} from "./processDeposit";
import {processProposerSlashing} from "./processProposerSlashing";
import {processVoluntaryExit} from "./processVoluntaryExit";

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
  state: BeaconState,
  block: BeaconBlock,
  verifySignatures = true,
): void {
  processBlockHeader(epochCtx, state, block);
  processRandao(epochCtx, state, block.body, verifySignatures);
  processEth1Data(epochCtx, state, block.body);
  processOperations(epochCtx, state, block.body, verifySignatures);
}
