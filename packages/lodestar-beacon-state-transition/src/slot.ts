/**
 * @module chain/stateTransition/slot
 */

import {BeaconState, Slot} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {assert} from "@chainsafe/lodestar-utils";

import {ZERO_HASH} from "./constants";

import {processEpoch} from "./epoch";

export function processSlots(
  config: IBeaconConfig,
  state: BeaconState,
  slot: Slot,
): void{
  assert(state.slot < slot);

  while (state.slot < slot){
    processSlot(config, state);
    // Process epoch on the first slot of the next epoch
    if ((state.slot + 1) % config.params.SLOTS_PER_EPOCH === 0){
      processEpoch(config, state);
    }
    state.slot++;
  }
}

function processSlot(config: IBeaconConfig, state: BeaconState): void {
  // Cache state root
  const previousStateRoot = config.types.BeaconState.hashTreeRoot(state);
  state.stateRoots[state.slot % config.params.SLOTS_PER_HISTORICAL_ROOT] = previousStateRoot;

  // Cache latest block header state root
  if (config.types.Root.equals(state.latestBlockHeader.stateRoot, ZERO_HASH)) {
    state.latestBlockHeader.stateRoot = previousStateRoot;
  }

  // Cache block root
  const previousBlockRoot = config.types.BeaconBlockHeader.hashTreeRoot(state.latestBlockHeader);
  state.blockRoots[state.slot % config.params.SLOTS_PER_HISTORICAL_ROOT] = previousBlockRoot;
}
