import {GENESIS_EPOCH} from "../../../constants";
import {CachedValidatorsBeaconState, EpochContext, IEpochProcess} from "../util";
import {getAttestationDeltas} from "./getAttestationDeltas";

export function processRewardsAndPenalties(
  epochCtx: EpochContext,
  process: IEpochProcess,
  state: CachedValidatorsBeaconState
): void {
  // No rewards are applied at the end of `GENESIS_EPOCH` because rewards are for work done in the previous epoch
  if (process.currentEpoch === GENESIS_EPOCH) {
    return;
  }
  const [rewards, penalties] = getAttestationDeltas(epochCtx, process, state.getOriginalState());
  state.updateBalances(rewards, penalties);
}
