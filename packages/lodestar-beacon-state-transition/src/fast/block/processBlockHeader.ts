import {BeaconBlock} from "@chainsafe/lodestar-types";

import {CachedBeaconState} from "../util/cachedBeaconState";

export function processBlockHeader(cachedState: CachedBeaconState, block: BeaconBlock): void {
  const types = cachedState.config.types;
  const slot = cachedState.slot;
  // verify that the slots match
  if (block.slot !== slot) {
    throw new Error("Block slot does not match state slot" + `blockSlot=${block.slot} stateSlot=${slot}`);
  }
  // Verify that the block is newer than latest block header
  if (!(block.slot > cachedState.latestBlockHeader.slot)) {
    throw new Error(
      "Block is not newer than latest block header" +
        `blockSlot=${block.slot} latestBlockHeader.slot=${cachedState.latestBlockHeader.slot}`
    );
  }
  // verify that proposer index is the correct index
  const proposerIndex = cachedState.getBeaconProposer(slot);
  if (block.proposerIndex !== proposerIndex) {
    throw new Error(
      "Block proposer index does not match state proposer index" +
        `blockProposerIndex=${block.proposerIndex} stateProposerIndex=${proposerIndex}`
    );
  }
  // verify that the parent matches
  if (!types.Root.equals(block.parentRoot, types.BeaconBlockHeader.hashTreeRoot(cachedState.latestBlockHeader))) {
    throw new Error("Block parent root does not match state latest block");
  }
  // cache current block as the new latest block
  cachedState.latestBlockHeader = {
    slot: slot,
    proposerIndex: block.proposerIndex,
    parentRoot: block.parentRoot,
    stateRoot: new Uint8Array(32),
    bodyRoot: types.BeaconBlockBody.hashTreeRoot(block.body),
  };

  // verify proposer is not slashed
  if (cachedState.validators[proposerIndex].slashed) {
    throw new Error("Block proposer is slashed");
  }
}
