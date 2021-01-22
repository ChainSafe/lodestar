/**
 * @module chain/stateTransition/slot
 */

import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BeaconState, Slot} from "@chainsafe/lodestar-types";
import {assert} from "@chainsafe/lodestar-utils";
import {ZERO_HASH} from "./constants";
import {processEpoch} from "./epoch";
import {LIGHTCLIENT_PATCH_FORK_SLOT, upgrade as lightclientUpgrade} from "./lightclient";

export function processSlots<TState extends BeaconState = BeaconState>(
  config: IBeaconConfig,
  state: TState,
  slot: Slot
): TState {
  assert.lt(state.slot, slot, `Too old slot ${slot}, current=${state.slot}`);

  while (state.slot < slot) {
    processSlot(config, state);
    // Process epoch on the first slot of the next epoch
    if ((state.slot + 1) % config.params.SLOTS_PER_EPOCH === 0) {
      processEpoch(config, state);
    }
    state.slot++;
    if (state.slot >= LIGHTCLIENT_PATCH_FORK_SLOT) {
      return (lightclientUpgrade(config, state) as unknown) as TState;
    }
  }
  return state;
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
