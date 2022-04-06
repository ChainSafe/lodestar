import {bellatrix} from "@chainsafe/lodestar-types";

import {CachedBeaconStateBellatrix} from "../../types.js";
import {processBlockHeader, processEth1Data, processRandao} from "../../allForks/block/index.js";
import {processOperations} from "./processOperations.js";
import {processSyncAggregate} from "../../altair/block/processSyncCommittee.js";
import {processExecutionPayload} from "./processExecutionPayload.js";
import {ExecutionEngine} from "../executionEngine.js";
import {isExecutionEnabled} from "../utils.js";
import {processAttesterSlashing} from "./processAttesterSlashing.js";
import {processProposerSlashing} from "./processProposerSlashing.js";

export {processOperations, processAttesterSlashing, processProposerSlashing};

export function processBlock(
  state: CachedBeaconStateBellatrix,
  block: bellatrix.BeaconBlock,
  verifySignatures = true,
  executionEngine: ExecutionEngine | null
): void {
  processBlockHeader(state, block);
  // The call to the process_execution_payload must happen before the call to the process_randao as the former depends
  // on the randao_mix computed with the reveal of the previous block.
  if (isExecutionEnabled(state, block.body)) {
    processExecutionPayload(state, block.body.executionPayload, executionEngine);
  }

  processRandao(state, block, verifySignatures);
  processEth1Data(state, block.body.eth1Data);
  processOperations(state, block.body, verifySignatures);
  processSyncAggregate(state, block, verifySignatures);
}
