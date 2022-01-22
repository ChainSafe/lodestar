import {bellatrix} from "@chainsafe/lodestar-types";

import {BeaconStateCachedAltair, BeaconStateCachedBellatrix, BeaconStateCachedAllForks} from "../../types";
import {processBlockHeader, processEth1Data, processRandao} from "../../allForks/block";
import {processOperations} from "./processOperations";
import {processSyncAggregate} from "../../altair/block/processSyncCommittee";
import {processExecutionPayload} from "./processExecutionPayload";
import {ExecutionEngine} from "../executionEngine";
import {isExecutionEnabled} from "../utils";
import {processAttesterSlashing} from "./processAttesterSlashing";
import {processProposerSlashing} from "./processProposerSlashing";

export {processOperations, processAttesterSlashing, processProposerSlashing};

export function processBlock(
  state: BeaconStateCachedBellatrix,
  block: bellatrix.BeaconBlock,
  verifySignatures = true,
  executionEngine: ExecutionEngine | null
): void {
  processBlockHeader(state as BeaconStateCachedAllForks, block);
  // The call to the process_execution_payload must happen before the call to the process_randao as the former depends
  // on the randao_mix computed with the reveal of the previous block.
  if (isExecutionEnabled(state, block.body)) {
    processExecutionPayload(state, block.body.executionPayload, executionEngine);
  }

  processRandao(state as BeaconStateCachedAllForks, block, verifySignatures);
  processEth1Data(state as BeaconStateCachedAllForks, block.body);
  processOperations(state, block.body, verifySignatures);
  processSyncAggregate((state as unknown) as BeaconStateCachedAltair, block, verifySignatures);
}
