import {phase0, ssz} from "@chainsafe/lodestar-types";
import {getCurrentEpoch} from "../../../util";
import {intDiv} from "@chainsafe/lodestar-utils";
import {SLOTS_PER_EPOCH, SLOTS_PER_HISTORICAL_ROOT} from "@chainsafe/lodestar-params";

export function processHistoricalRootsUpdate(state: phase0.BeaconState): void {
  const currentEpoch = getCurrentEpoch(state);
  const nextEpoch = currentEpoch + 1;
  // Set historical root accumulator
  if (nextEpoch % intDiv(SLOTS_PER_HISTORICAL_ROOT, SLOTS_PER_EPOCH) === 0) {
    const historicalBatch: phase0.HistoricalBatch = {
      blockRoots: state.blockRoots,
      stateRoots: state.stateRoots,
    };
    state.historicalRoots.push(ssz.phase0.HistoricalBatch.hashTreeRoot(historicalBatch));
  }
}
