import {allForks, altair, merge} from "@chainsafe/lodestar-types";

import {CachedBeaconState} from "../../allForks/util";
import {processBlockHeader, processEth1Data, processRandao} from "../../allForks/block";
import {processOperations} from "../../altair/block/processOperations";
import {processSyncAggregate} from "../../altair/block/processSyncCommittee";
import {processExecutionPayload, isExecutionEnabled} from "./processExecutionPayload";
import {ExecutionEngine} from "../executionEngine";

export function processBlock(
  state: CachedBeaconState<merge.BeaconState>,
  block: merge.BeaconBlock,
  verifySignatures = true,
  executionEngine: ExecutionEngine | null
): void {
  processBlockHeader(state as CachedBeaconState<allForks.BeaconState>, block);
  processRandao(state as CachedBeaconState<allForks.BeaconState>, block, verifySignatures);
  processEth1Data(state as CachedBeaconState<allForks.BeaconState>, block.body);
  processOperations((state as unknown) as CachedBeaconState<altair.BeaconState>, block.body, verifySignatures);
  processSyncAggregate((state as unknown) as CachedBeaconState<altair.BeaconState>, block, verifySignatures);
  if (isExecutionEnabled(state, block.body)) {
    processExecutionPayload(state, block.body.executionPayload, executionEngine);
  }
}
