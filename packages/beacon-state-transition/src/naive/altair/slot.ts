import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair, Slot, phase0, ssz} from "@chainsafe/lodestar-types";
import {assert} from "@chainsafe/lodestar-utils";
import {processEpoch} from "./epoch";
import {ZERO_HASH} from "../../constants";
import {SLOTS_PER_EPOCH, SLOTS_PER_HISTORICAL_ROOT} from "@chainsafe/lodestar-params";

export function processSlots(config: IBeaconConfig, state: altair.BeaconState, slot: Slot): void {
  assert.lt(state.slot, slot, `Too old slot ${slot}, current=${state.slot}`);

  while (state.slot < slot) {
    processSlot(state);
    // Process epoch on the first slot of the next epoch
    if ((state.slot + 1) % SLOTS_PER_EPOCH === 0) {
      processEpoch(config, state as altair.BeaconState & phase0.BeaconState);
    }
    state.slot++;
  }
}

function processSlot(state: altair.BeaconState): void {
  // Cache state root
  const previousStateRoot = ssz.altair.BeaconState.hashTreeRoot(state);
  state.stateRoots[state.slot % SLOTS_PER_HISTORICAL_ROOT] = previousStateRoot;

  // Cache latest block header state root
  if (ssz.Root.equals(state.latestBlockHeader.stateRoot, ZERO_HASH)) {
    state.latestBlockHeader.stateRoot = previousStateRoot;
  }

  // Cache block root
  const previousBlockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(state.latestBlockHeader);
  state.blockRoots[state.slot % SLOTS_PER_HISTORICAL_ROOT] = previousBlockRoot;
}
