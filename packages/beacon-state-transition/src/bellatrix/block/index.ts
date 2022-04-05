import {bellatrix} from "@chainsafe/lodestar-types";

import {CachedBeaconStateBellatrix} from "../../types";
import {processBlockHeader, processEth1Data, processRandao} from "../../allForks/block";
import {processSyncAggregate} from "../../altair/block/processSyncCommittee";
import {ExecutionEngine} from "../executionEngine";
import {isExecutionEnabled} from "../utils";
import {processProposerSlashing} from "./processProposerSlashing";
import {processAttesterSlashing} from "./processAttesterSlashing";
import {processExecutionPayload} from "./processExecutionPayload";
import {processOperations} from "./processOperations";

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
