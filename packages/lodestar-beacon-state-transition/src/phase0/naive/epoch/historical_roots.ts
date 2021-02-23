import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {phase0} from "@chainsafe/lodestar-types";
import {getCurrentEpoch} from "../../..";
import {intDiv} from "@chainsafe/lodestar-utils";

export function processHistoricalRootsUpdate(config: IBeaconConfig, state: phase0.BeaconState): void {
  const currentEpoch = getCurrentEpoch(config, state);
  const nextEpoch = currentEpoch + 1;
  // Set historical root accumulator
  if (nextEpoch % intDiv(config.params.SLOTS_PER_HISTORICAL_ROOT, config.params.SLOTS_PER_EPOCH) === 0) {
    const historicalBatch: phase0.HistoricalBatch = {
      blockRoots: state.blockRoots,
      stateRoots: state.stateRoots,
    };
    state.historicalRoots.push(config.types.phase0.HistoricalBatch.hashTreeRoot(historicalBatch));
  }
}
