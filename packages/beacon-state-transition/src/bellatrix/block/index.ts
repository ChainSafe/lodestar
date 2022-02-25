import {bellatrix} from "@chainsafe/lodestar-types";

import {processOperations} from "./processOperations";
import {processExecutionPayload} from "./processExecutionPayload";
import {processAttesterSlashing} from "./processAttesterSlashing";
import {processProposerSlashing} from "./processProposerSlashing";
import {CachedBeaconStateAltair, CachedBeaconStateBellatrix, CachedBeaconStateAllForks} from "../../types";
import {processBlockHeader, processEth1Data, processRandao} from "../../allForks/block";
import {processSyncAggregate} from "../../altair/block/processSyncCommittee";
import {ExecutionEngine} from "../executionEngine";
import {isExecutionEnabled} from "../utils";

export {processOperations, processAttesterSlashing, processProposerSlashing};

export function processBlock(
  state: CachedBeaconStateBellatrix,
  block: bellatrix.BeaconBlock,
  verifySignatures = true,
  executionEngine: ExecutionEngine | null
): void {
  processBlockHeader(state as CachedBeaconStateAllForks, block);
  // The call to the process_execution_payload must happen before the call to the process_randao as the former depends
  // on the randao_mix computed with the reveal of the previous block.
  if (isExecutionEnabled(state, block.body)) {
    processExecutionPayload(state, block.body.executionPayload, executionEngine);
  }

  processRandao(state as CachedBeaconStateAllForks, block, verifySignatures);
  processEth1Data(state as CachedBeaconStateAllForks, block.body);
  processOperations(state, block.body, verifySignatures);
  processSyncAggregate((state as unknown) as CachedBeaconStateAltair, block, verifySignatures);
}
