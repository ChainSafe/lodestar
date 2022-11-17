import {ssz} from "@lodestar/types";
import {CachedBeaconStateEip4844} from "../types.js";
import {getCachedBeaconState} from "../cache/stateCache.js";
import {CachedBeaconStateCapella} from "../types.js";

/**
 * Upgrade a state from Capella to 4844.
 */
export function upgradeStateTo4844(stateCapella: CachedBeaconStateCapella): CachedBeaconStateEip4844 {
  const {config} = stateCapella;

  const stateCapellaNode = ssz.capella.BeaconState.commitViewDU(stateCapella);
  const state4844View = ssz.eip4844.BeaconState.getViewDU(stateCapellaNode);

  const state4844 = getCachedBeaconState(state4844View, stateCapella);

  state4844.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: stateCapella.fork.currentVersion,
    currentVersion: config.EIP4844_FORK_VERSION,
    epoch: stateCapella.epochCtx.epoch,
  });

  // capella.latestExecutionPayloadHeader has 15 properties, adding only 1 extra will not increase the tree depth.
  // The initial value of the new property 'excessDataGas' is zero, so the default tree value is correct.
  // Just casting the same tree node to state4844 is sufficient and nothing has to be done.
  // ```
  // state4844.latestExecutionPayloadHeader.excessDataGas = ssz.UintBn256.defaultValue()
  // ```

  state4844.commit();

  return state4844;
}
