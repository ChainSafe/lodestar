import {ssz} from "@lodestar/types";
import {CachedBeaconStateEip7805, CachedBeaconStateFulu, getCachedBeaconState} from "../cache/stateCache.js";

/**
 * Upgrade a state from Deneb to Electra.
 */
export function upgradeStateToEip7805(stateFulu: CachedBeaconStateFulu): CachedBeaconStateEip7805 {
  const {config} = stateFulu;

  const stateFuluNode = ssz.fulu.BeaconState.commitViewDU(stateFulu);
  const stateEip7805View = ssz.eip7805.BeaconState.getViewDU(stateFuluNode);
  // Attach existing BeaconStateCache from stateAltair to new stateBellatrixView object
  const stateEip7805 = getCachedBeaconState(stateEip7805View, stateFulu);

  stateEip7805.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: stateFulu.fork.currentVersion,
    currentVersion: config.EIP7805_FORK_VERSION,
    epoch: stateFulu.epochCtx.epoch,
  });

  // Commit new added fields ViewDU to the root node
  stateEip7805.commit();
  // No need to clear cache since no index is replaced, only appended at the end
  return stateEip7805;
}
