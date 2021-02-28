import {phase0} from "@chainsafe/lodestar-types";

import {CachedBeaconState} from "../util";

export function processBlockHeader(state: CachedBeaconState<phase0.BeaconState>, block: phase0.BeaconBlock): void {
  const types = state.config.types;
  const slot = state.slot;
  // verify that the slots match
  if (block.slot !== slot) {
    throw new Error("Block slot does not match state slot" + `blockSlot=${block.slot} stateSlot=${slot}`);
  }
  // Verify that the block is newer than latest block header
  if (!(block.slot > state.latestBlockHeader.slot)) {
    throw new Error(
      "Block is not newer than latest block header" +
        `blockSlot=${block.slot} latestBlockHeader.slot=${state.latestBlockHeader.slot}`
    );
  }
  // verify that proposer index is the correct index
  const proposerIndex = state.getBeaconProposer(slot);
  if (block.proposerIndex !== proposerIndex) {
    throw new Error(
      "Block proposer index does not match state proposer index" +
        `blockProposerIndex=${block.proposerIndex} stateProposerIndex=${proposerIndex}`
    );
  }
  // verify that the parent matches
  if (!types.Root.equals(block.parentRoot, types.phase0.BeaconBlockHeader.hashTreeRoot(state.latestBlockHeader))) {
    throw new Error("Block parent root does not match state latest block");
  }
  // cache current block as the new latest block
  state.latestBlockHeader = {
    slot: slot,
    proposerIndex: block.proposerIndex,
    parentRoot: block.parentRoot,
    stateRoot: new Uint8Array(32),
    bodyRoot: types.phase0.BeaconBlockBody.hashTreeRoot(block.body),
  };

  // verify proposer is not slashed
  if (state.validators[proposerIndex].slashed) {
    throw new Error("Block proposer is slashed");
  }
}
