import {ForkSeq, SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {byteArrayEquals} from "@lodestar/utils";
import {ZERO_HASH} from "../constants/index.js";
import {CachedBeaconStateAllForks, CachedBeaconStateEip8453, CachedBeaconStateGloas} from "../types.js";

export {upgradeStateToAltair} from "./upgradeStateToAltair.js";
export {upgradeStateToBellatrix} from "./upgradeStateToBellatrix.js";
export {upgradeStateToCapella} from "./upgradeStateToCapella.js";
export {upgradeStateToDeneb} from "./upgradeStateToDeneb.js";
export {upgradeStateToEip8453} from "./upgradeStateToEip8453.js";
export {upgradeStateToElectra} from "./upgradeStateToElectra.js";
export {upgradeStateToFulu} from "./upgradeStateToFulu.js";
export {upgradeStateToGloas} from "./upgradeStateToGloas.js";
export {upgradeStateToHeze} from "./upgradeStateToHeze.js";

/**
 * Dial state to next slot. Common for all forks
 */
export function processSlot(fork: ForkSeq, state: CachedBeaconStateAllForks): void {
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

  if (fork >= ForkSeq.eip8453) {
    // [New in EIP8453] The block that advanced the height is the target of the new height, and a post-state cannot
    // contain the root of its own block, so advance_height leaves the target root empty and it is filled here.
    const targetCheckpoint = (state as CachedBeaconStateEip8453).targetCheckpoint;
    if (byteArrayEquals(targetCheckpoint.root, ZERO_HASH)) {
      targetCheckpoint.root = previousBlockRoot;
    }
  }

  if (fork >= ForkSeq.gloas) {
    // Unset the next payload availability
    (state as CachedBeaconStateGloas).executionPayloadAvailability.set(
      (state.slot + 1) % SLOTS_PER_HISTORICAL_ROOT,
      false
    );
  }
}
