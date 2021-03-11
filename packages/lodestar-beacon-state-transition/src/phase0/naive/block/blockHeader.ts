/**
 * @module chain/stateTransition/block
 */

import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {phase0} from "@chainsafe/lodestar-types";
import {assert} from "@chainsafe/lodestar-utils";
import {getBeaconProposerIndex, getTemporaryBlockHeader} from "../../../util";

export function processBlockHeader(config: IBeaconConfig, state: phase0.BeaconState, block: phase0.BeaconBlock): void {
  // Verify that the slots match
  assert.equal(block.slot, state.slot, "Slots do not match");
  // Verify that the block is newer than latest block header
  assert.gt(block.slot, state.latestBlockHeader.slot, "Block is not newer than latest block header");
  // Verify that proposer index is the correct index
  assert.equal(block.proposerIndex, getBeaconProposerIndex(config, state), "Incorrect proposer index");
  // Verify that the parent matches
  assert.true(
    config.types.Root.equals(
      block.parentRoot,
      config.types.phase0.BeaconBlockHeader.hashTreeRoot(state.latestBlockHeader)
    ),
    "Parent block roots do not match"
  );
  // Save current block as the new latest block
  state.latestBlockHeader = getTemporaryBlockHeader(config, block);

  // Verify proposer is not slashed
  assert.true(!state.validators[block.proposerIndex].slashed, "Proposer must not be slashed");
}
