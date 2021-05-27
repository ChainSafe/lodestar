/**
 * @module chain/stateTransition/slot
 */

import {phase0, Slot, ssz} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {assert} from "@chainsafe/lodestar-utils";
import {ZERO_HASH} from "../../constants";
import {processEpoch} from "./epoch";
import {SLOTS_PER_EPOCH, SLOTS_PER_HISTORICAL_ROOT} from "@chainsafe/lodestar-params";

export function processSlots(config: IBeaconConfig, state: phase0.BeaconState, slot: Slot): void {
  assert.lt(state.slot, slot, `Too old slot ${slot}, current=${state.slot}`);

  while (state.slot < slot) {
    processSlot(state);
    // Process epoch on the first slot of the next epoch
    if ((state.slot + 1) % SLOTS_PER_EPOCH === 0) {
      processEpoch(config, state);
    }
    state.slot++;
  }
}

function processSlot(state: phase0.BeaconState): void {
  // Cache state root
  const previousStateRoot = ssz.phase0.BeaconState.hashTreeRoot(state);
  state.stateRoots[state.slot % SLOTS_PER_HISTORICAL_ROOT] = previousStateRoot;

  // Cache latest block header state root
  if (ssz.Root.equals(state.latestBlockHeader.stateRoot, ZERO_HASH)) {
    state.latestBlockHeader.stateRoot = previousStateRoot;
  }

  // Cache block root
  const previousBlockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(state.latestBlockHeader);
  state.blockRoots[state.slot % SLOTS_PER_HISTORICAL_ROOT] = previousBlockRoot;
}
