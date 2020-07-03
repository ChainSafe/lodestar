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
  assert.equal(block.slot, state.slot, "Slots do not match");
  // Verify that proposer index is the correct index
  assert.equal(block.proposerIndex, getBeaconProposerIndex(config, state), "Incorrect proposer index");
  // Verify that the parent matches
  assert.true(config.types.Root.equals(
    block.parentRoot,
    config.types.BeaconBlockHeader.hashTreeRoot(state.latestBlockHeader)
  ), "Parent block roots do not match");
  // Save current block as the new latest block
  state.latestBlockHeader = getTemporaryBlockHeader(config, block);

  // Verify proposer is not slashed
  assert.true(!state.validators[block.proposerIndex].slashed, "Proposer must not be slashed");
}
