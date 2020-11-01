import {BeaconBlock, BeaconState} from "@chainsafe/lodestar-types";
import {EpochContext} from "../util";
import {processBlockHeader} from "./processBlockHeader";
import {processRandao} from "./processRandao";
import {processEth1Data} from "./processEth1Data";
import {processOperations} from "./processOperations";

export * from "./processBlockHeader";
export * from "./processRandao";
export * from "./processEth1Data";
export * from "./processOperations";
export * from "./processAttestation";
export * from "./processAttesterSlashing";
export * from "./processDeposit";
export * from "./processProposerSlashing";
export * from "./processVoluntaryExit";

export function processBlock(
  epochCtx: EpochContext,
  state: BeaconState,
  block: BeaconBlock,
  verifySignatures = true
): void {
  processBlockHeader(epochCtx, state, block);
  processRandao(epochCtx, state, block.body, verifySignatures);
  processEth1Data(epochCtx, state, block.body);
  processOperations(epochCtx, state, block.body, verifySignatures);
}
