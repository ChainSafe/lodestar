import {ssz} from "@lodestar/types";
import {CachedBeaconState4844} from "../types.js";
import {getCachedBeaconState} from "../cache/stateCache.js";
import {CachedBeaconStateCapella} from "../types.js";

/**
 * Upgrade a state from Capella to 4844.
 */
export function upgradeStateTo4844(stateCapella: CachedBeaconStateCapella): CachedBeaconState4844 {
  const {config} = stateCapella;

  const stateCapellaNode = ssz.capella.BeaconState.commitViewDU(stateCapella);
  const state4844View = ssz.eip4844.BeaconState.getViewDU(stateCapellaNode);

  const state4844 = getCachedBeaconState(state4844View, stateCapella);

  state4844.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: stateCapella.fork.currentVersion,
    currentVersion: config.EIP4844_FORK_VERSION,
    epoch: stateCapella.epochCtx.epoch,
  });

  state4844.latestExecutionPayloadHeader = ssz.eip4844.ExecutionPayloadHeader.toViewDU({
    ...stateCapella.latestExecutionPayloadHeader,
    excessDataGas: ssz.UintBn256.defaultValue(),
  });

  state4844.commit();

  return state4844;
}
