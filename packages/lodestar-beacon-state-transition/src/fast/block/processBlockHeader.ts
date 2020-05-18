import {BeaconBlock, BeaconState} from "@chainsafe/lodestar-types";

import {EpochContext} from "../util";


export function processBlockHeader(
  epochCtx: EpochContext,
  state: BeaconState,
  block: BeaconBlock
): void {
  const types = epochCtx.config.types;
  const slot = state.slot;
  // verify that the slots match
  if (block.slot !== slot) {
    throw new Error();
  }
  // verify that proposer index is the correct index
  const proposerIndex = epochCtx.getBeaconProposer(slot);
  if (block.proposerIndex !== proposerIndex) {
    throw new Error();
  }
  // verify that the parent matches
  if (!types.Root.equals(block.parentRoot, types.BeaconBlockHeader.hashTreeRoot(state.latestBlockHeader))) {
    throw new Error();
  }
  // cache current block as the new latest block
  state.latestBlockHeader = {
    slot: slot,
    proposerIndex: block.proposerIndex,
    parentRoot: block.parentRoot,
    stateRoot: new Uint8Array(32),
    bodyRoot: types.BeaconBlockBody.hashTreeRoot(block.body),
  };

  // verify proposer is not slashed
  if (state.validators[proposerIndex].slashed) {
    throw new Error();
  }
}
