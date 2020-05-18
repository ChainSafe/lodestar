import {EpochContext} from "../util";
import {BeaconBlock, BeaconState} from "@chainsafe/lodestar-types";

import {processBlockHeader} from "./processBlockHeader";
import {processRandao} from "./processRandao";
import {processEth1Data} from "./processEth1Data";
import {processOperations} from "./processOperations";

export {
  processBlockHeader,
  processRandao,
  processEth1Data,
  processOperations,
};

export function processBlock(
  epochCtx: EpochContext,
  state: BeaconState,
  block: BeaconBlock
): void {
  processBlockHeader(epochCtx, state, block);
  processRandao(epochCtx, state, block.body);
  processEth1Data(epochCtx, state, block.body);
  processOperations(epochCtx, state, block.body);
}
