import {allForks, altair, Slot} from "@chainsafe/lodestar-types";
import {assert} from "@chainsafe/lodestar-utils";
import {processEpoch} from "./epoch";
import {CachedBeaconState, rotateEpochs} from "../allForks/util";
import {ZERO_HASH} from "../constants";

export function processSlots(state: CachedBeaconState<altair.BeaconState>, slot: Slot): void {
  assert.lt(state.slot, slot, `Too old slot ${slot}, current=${state.slot}`);
  const {config} = state;

  while (state.slot < slot) {
    processSlot(state);
    // Process epoch on the first slot of the next epoch
    if ((state.slot + 1) % config.params.SLOTS_PER_EPOCH === 0) {
      processEpoch(state);
      state.slot++;
      rotateEpochs(state.epochCtx, state as CachedBeaconState<allForks.BeaconState>, state.validators);
    } else {
      state.slot++;
    }
  }
}

function processSlot(state: CachedBeaconState<altair.BeaconState>): void {
  const {config} = state;
  // Cache state root
  const previousStateRoot = config.types.altair.BeaconState.hashTreeRoot(state);
  state.stateRoots[state.slot % config.params.SLOTS_PER_HISTORICAL_ROOT] = previousStateRoot;

  // Cache latest block header state root
  if (config.types.Root.equals(state.latestBlockHeader.stateRoot, ZERO_HASH)) {
    state.latestBlockHeader.stateRoot = previousStateRoot;
  }

  // Cache block root
  const previousBlockRoot = config.types.altair.BeaconBlockHeader.hashTreeRoot(state.latestBlockHeader);
  state.blockRoots[state.slot % config.params.SLOTS_PER_HISTORICAL_ROOT] = previousBlockRoot;
}
