import {SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {byteArrayEquals} from "@chainsafe/ssz";
import {CachedBeaconStateAllForks} from "../types.js";
import {ZERO_HASH} from "../constants/index.js";

export {upgradeStateToAltair} from "./upgrade_state_to_altair.js";
export {upgradeStateToBellatrix} from "./upgrade_state_to_bellatrix.js";
export {upgradeStateToCapella} from "./upgrade_state_to_capella.js";
export {upgradeStateToDeneb} from "./upgrade_state_to_deneb.js";

/**
 * Dial state to next slot. Common for all forks
 */
export function processSlot(state: CachedBeaconStateAllForks): void {
  // Cache state root
  // Note: .hashTreeRoot() automatically commits() pending changes
  const previousStateRoot = state.hashTreeRoot();
  state.stateRoots.set(state.slot % SLOTS_PER_HISTORICAL_ROOT, previousStateRoot);

  // Cache latest block header state root
  if (byteArrayEquals(state.latestBlockHeader.stateRoot, ZERO_HASH)) {
    state.latestBlockHeader.stateRoot = previousStateRoot;
  }

  // Cache block root
  // Note: .hashTreeRoot() automatically commits() pending changes
  const previousBlockRoot = state.latestBlockHeader.hashTreeRoot();
  state.blockRoots.set(state.slot % SLOTS_PER_HISTORICAL_ROOT, previousBlockRoot);
}
