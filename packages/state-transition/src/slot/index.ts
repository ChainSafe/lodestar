import {byteArrayEquals} from "@chainsafe/ssz";
import {SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {CachedBeaconStateAllForks} from "../types.js";
import {ZERO_HASH} from "../constants/index.js";

export {upgradeStateToAltair} from "./upgradeStateToAltair.js";
export {upgradeStateToBellatrix} from "./upgradeStateToBellatrix.js";
export {upgradeStateToCapella} from "./upgradeStateToCapella.js";
export {upgradeStateToDeneb} from "./upgradeStateToDeneb.js";
export {upgradeStateToElectra} from "./upgradeStateToElectra.js";

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
