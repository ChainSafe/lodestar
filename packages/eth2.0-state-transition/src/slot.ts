/**
 * @module chain/stateTransition/slot
 */

import assert from "assert";
import {hashTreeRoot, signingRoot} from "@chainsafe/ssz";
import {BeaconState, Slot,} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {ZERO_HASH} from "./constants";

import {processEpoch} from "./epoch";

export function processSlots(
  config: IBeaconConfig,
  state: BeaconState,
  slot: Slot,
): void{
  assert(state.slot <= slot);

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
  const previousStateRoot = hashTreeRoot(config.types.BeaconState, state);
  state.stateRoots[state.slot % config.params.SLOTS_PER_HISTORICAL_ROOT] = previousStateRoot;

  // Cache latest block header state root
  if (state.latestBlockHeader.stateRoot.equals(ZERO_HASH)) {
    state.latestBlockHeader.stateRoot = previousStateRoot;
  }

  // Cache block root
  const previousBlockRoot = signingRoot(config.types.BeaconBlockHeader, state.latestBlockHeader);
  state.blockRoots[state.slot % config.params.SLOTS_PER_HISTORICAL_ROOT] = previousBlockRoot;
}
