import {allForks, altair, merge} from "@chainsafe/lodestar-types";

import {CachedBeaconState} from "../../allForks/util";
import {processBlockHeader, processEth1Data, processRandao} from "../../allForks/block";
import {processOperations} from "../../altair/block/processOperations";
import {processSyncAggregate} from "../../altair/block/processSyncCommittee";
import {processExecutionPayload} from "./processExecutionPayload";
import {ExecutionEngine} from "../executionEngine";
import {isExecutionEnabled} from "../utils";

export function processBlock(
  state: CachedBeaconState<merge.BeaconState>,
  block: merge.BeaconBlock,
  verifySignatures = true,
  executionEngine: ExecutionEngine | null
): void {
  processBlockHeader(state as CachedBeaconState<allForks.BeaconState>, block);
  // The call to the process_execution_payload must happen before the call to the process_randao as the former depends
  // on the randao_mix computed with the reveal of the previous block.
  if (isExecutionEnabled(state, block.body)) {
    processExecutionPayload(state, block.body.executionPayload, executionEngine);
  }

  processRandao(state as CachedBeaconState<allForks.BeaconState>, block, verifySignatures);
  processEth1Data(state as CachedBeaconState<allForks.BeaconState>, block.body);
  processOperations((state as unknown) as CachedBeaconState<altair.BeaconState>, block.body, verifySignatures);
  processSyncAggregate((state as unknown) as CachedBeaconState<altair.BeaconState>, block, verifySignatures);
}
