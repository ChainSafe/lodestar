/**
 * @module chain/stateTransition/block
 */

import {BeaconBlock, BeaconState} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {assert} from "@chainsafe/lodestar-utils";

import {getTemporaryBlockHeader, getBeaconProposerIndex} from "../util";

export function processBlockHeader(
  config: IBeaconConfig,
  state: BeaconState,
  block: BeaconBlock,
): void {
  // Verify that the slots match
  assert(block.slot === state.slot);
  // Verify that the block is newer than latest block header
  assert(block.slot > state.latestBlockHeader.slot);
  // Verify that proposer index is the correct index
  assert(block.proposerIndex === getBeaconProposerIndex(config, state));
  // Verify that the parent matches
  assert(config.types.Root.equals(
    block.parentRoot,
    config.types.BeaconBlockHeader.hashTreeRoot(state.latestBlockHeader))
  );
  // Save current block as the new latest block
  state.latestBlockHeader = getTemporaryBlockHeader(config, block);

  // Verify proposer is not slashed
  assert(!state.validators[block.proposerIndex].slashed);
}
