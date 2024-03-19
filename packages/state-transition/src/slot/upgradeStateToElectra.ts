import {ssz} from "@lodestar/types";
import {CachedBeaconStateCapella, CachedBeaconStateElectra} from "../types.js";
import {getCachedBeaconState} from "../cache/stateCache.js";

/**
 * Upgrade a state from Capella (Eventualy DENEB) to Electra.
 */
export function upgradeStateToElectra(stateCapella: CachedBeaconStateCapella): CachedBeaconStateElectra {
  const {config} = stateCapella;

  const stateCapellaNode = ssz.capella.BeaconState.commitViewDU(stateCapella);
  const stateElectraView = ssz.electra.BeaconState.getViewDU(stateCapellaNode);

  const stateElectra = getCachedBeaconState(stateElectraView, stateCapella);

  stateElectra.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: stateCapella.fork.currentVersion,
    currentVersion: config.ELECTRA_FORK_VERSION,
    epoch: stateCapella.epochCtx.epoch,
  });

  // latestExecutionPayloadHeader's executionWitnessRoot will have default zero root

  stateElectra.commit();
  return stateElectra;
}
