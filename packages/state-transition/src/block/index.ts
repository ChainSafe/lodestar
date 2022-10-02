import {ForkSeq} from "@lodestar/params";
import {allForks, altair} from "@lodestar/types";
import {ExecutionEngine} from "../util/executionEngine.js";
import {getFullOrBlindedPayload, isExecutionEnabled} from "../util/execution.js";
import {CachedBeaconStateAllForks, CachedBeaconStateBellatrix} from "../types.js";
import {processExecutionPayload} from "./processExecutionPayload.js";
import {processSyncAggregate} from "./processSyncCommittee.js";
import {processBlockHeader} from "./processBlockHeader.js";
import {processEth1Data} from "./processEth1Data.js";
import {processOperations} from "./processOperations.js";
import {processRandao} from "./processRandao.js";

// Spec tests
export {processBlockHeader, processExecutionPayload, processRandao, processEth1Data, processSyncAggregate};
export * from "./processOperations.js";

export * from "./initiateValidatorExit.js";
export * from "./isValidIndexedAttestation.js";

export function processBlock(
  fork: ForkSeq,
  state: CachedBeaconStateAllForks,
  block: allForks.FullOrBlindedBeaconBlock,
  verifySignatures = true,
  executionEngine: ExecutionEngine | null
): void {
  processBlockHeader(state, block);

  // The call to the process_execution_payload must happen before the call to the process_randao as the former depends
  // on the randao_mix computed with the reveal of the previous block.
  if (fork >= ForkSeq.bellatrix) {
    const fullOrBlindedPayload = getFullOrBlindedPayload(block);

    if (isExecutionEnabled(state as CachedBeaconStateBellatrix, block)) {
      processExecutionPayload(state as CachedBeaconStateBellatrix, fullOrBlindedPayload, executionEngine);
    }
  }

  processRandao(state, block, verifySignatures);
  processEth1Data(state, block.body.eth1Data);
  processOperations(fork, state, block.body, verifySignatures);
  if (fork >= ForkSeq.altair) {
    processSyncAggregate(state, block as altair.BeaconBlock, verifySignatures);
  }
}
