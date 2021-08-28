import {toHexString} from "@chainsafe/ssz";
import {allForks, ssz} from "@chainsafe/lodestar-types";
import {CachedBeaconState} from "../util";
import {ZERO_HASH} from "../../constants";

/**
 * Converts a Deposit record (created by the eth1 deposit contract) into a Validator object that goes into the eth2 state.
 *
 * PERF: Fixed work independent of block contents.
 * NOTE: `block` body root MUST be pre-cached.
 */
export function processBlockHeader(state: CachedBeaconState<allForks.BeaconState>, block: allForks.BeaconBlock): void {
  const slot = state.slot;
  // verify that the slots match
  if (block.slot !== slot) {
    throw new Error(`Block slot does not match state slot blockSlot=${block.slot} stateSlot=${slot}`);
  }
  // Verify that the block is newer than latest block header
  if (!(block.slot > state.latestBlockHeader.slot)) {
    throw new Error(
      `Block is not newer than latest block header blockSlot=${block.slot} latestBlockHeader.slot=${state.latestBlockHeader.slot}`
    );
  }
  // verify that proposer index is the correct index
  const proposerIndex = state.getBeaconProposer(slot);
  if (block.proposerIndex !== proposerIndex) {
    throw new Error(
      `Block proposer index does not match state proposer index blockProposerIndex=${block.proposerIndex} stateProposerIndex=${proposerIndex}`
    );
  }

  const types = state.config.getForkTypes(slot);
  // verify that the parent matches
  if (!ssz.Root.equals(block.parentRoot, ssz.phase0.BeaconBlockHeader.hashTreeRoot(state.latestBlockHeader))) {
    throw new Error(
      `Block parent root ${toHexString(block.parentRoot)} does not match state latest block, block slot=${slot}`
    );
  }
  // cache current block as the new latest block
  state.latestBlockHeader = {
    slot: slot,
    proposerIndex: block.proposerIndex,
    parentRoot: block.parentRoot,
    stateRoot: ZERO_HASH,
    bodyRoot: types.BeaconBlockBody.hashTreeRoot(block.body),
  };

  // verify proposer is not slashed. Only once per block, may use the slower read from tree
  if (state.validators[proposerIndex].slashed) {
    throw new Error("Block proposer is slashed");
  }
}
