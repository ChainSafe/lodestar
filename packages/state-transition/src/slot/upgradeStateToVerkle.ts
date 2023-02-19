import {ssz} from "@lodestar/types";
import {CachedBeaconStateCapella, CachedBeaconStateVerkle} from "../types.js";
import {getCachedBeaconState} from "../cache/stateCache.js";

/**
 * Upgrade a state from Capella (Eventualy DENEB) to Verkle.
 */
export function upgradeStateToVerkle(stateCapella: CachedBeaconStateCapella): CachedBeaconStateVerkle {
  const {config} = stateCapella;

  const stateCapellaNode = ssz.capella.BeaconState.commitViewDU(stateCapella);
  const stateVerkleView = ssz.verkle.BeaconState.getViewDU(stateCapellaNode);

  const stateVerkle = getCachedBeaconState(stateVerkleView, stateCapella);

  stateVerkle.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: stateCapella.fork.currentVersion,
    currentVersion: config.VERKLE_FORK_VERSION,
    epoch: stateCapella.epochCtx.epoch,
  });

  // latestExecutionPayloadHeader's executionWitnessRoot will have default zero root

  stateVerkle.commit();
  return stateVerkle;
}
