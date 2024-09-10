import {deneb, electra} from "@lodestar/types";
import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {BlockGenerationOptionsDeneb, generateDenebBeaconBlocks} from "./deneb.js";

export function generateElectraExecutionPayload(payload: deneb.ExecutionPayload): electra.ExecutionPayload {
  return {
    ...payload,
    depositRequests: [],
    withdrawalRequests: [],
    consolidationRequests: [],
  };
}

export interface BlockGenerationOptionsElectra extends BlockGenerationOptionsDeneb {}

export function generateElectraBeaconBlocks(
  state: CachedBeaconStateAllForks,
  count: number,
  opts?: BlockGenerationOptionsElectra
): electra.BeaconBlock[] {
  const blocks = generateDenebBeaconBlocks(state, count, opts) as electra.BeaconBlock[];
  for (const block of blocks) {
    block.body.executionPayload = generateElectraExecutionPayload(block.body.executionPayload);
  }
  return blocks;
}
