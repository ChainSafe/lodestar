import {ssz} from "@lodestar/types";
import {CachedBeaconStateEip7805, CachedBeaconStateElectra, getCachedBeaconState} from "../cache/stateCache.js";

/**
 * Upgrade a state from Deneb to Electra.
 */
export function upgradeStateToEip7805(stateElectra: CachedBeaconStateElectra): CachedBeaconStateEip7805 {
  const {config} = stateElectra;

  const stateElectraNode = ssz.electra.BeaconState.commitViewDU(stateElectra);
  const stateEip7805View = ssz.eip7805.BeaconState.getViewDU(stateElectraNode);
  // Attach existing BeaconStateCache from stateAltair to new stateBellatrixView object
  const stateEip7805 = getCachedBeaconState(stateEip7805View, stateElectra);

  stateEip7805.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: stateElectra.fork.currentVersion,
    currentVersion: config.EIP7805_FORK_VERSION,
    epoch: stateElectra.epochCtx.epoch,
  });

  // Commit new added fields ViewDU to the root node
  stateEip7805.commit();
  // No need to clear cache since no index is replaced, only appended at the end
  return stateEip7805;
}
