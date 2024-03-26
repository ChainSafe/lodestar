import {COMPOUNDING_WITHDRAWAL_PREFIX, EPOCHS_PER_ETH1_VOTING_PERIOD} from "@lodestar/params";
import {phase0, ssz} from "@lodestar/types";
import {EpochTransitionCache, CachedBeaconStateAllForks, CachedBeaconStateElectra} from "../types.js";
import { decreaseBalance, increaseBalance } from "../util/balance.js";
import { hasEth1WithdrawalCredential } from "../util/capella.js";

/**
 * TODO Electra: jdoc
 */
export function processPendingConsolidations(state: CachedBeaconStateElectra): void {
  let nextPendingConsolidation = 0;

  for (const pendingConsolidation of state.pendingConsolidations.getAllReadonly()) {
    const {sourceIndex, targetIndex} = pendingConsolidation;
    const sourceValidator = state.validators.getReadonly(sourceIndex);

    if (sourceValidator.slashed) {
      nextPendingConsolidation ++;
      continue;
    }

    if (sourceValidator.withdrawableEpoch > state.epochCtx.epoch){
      break;
    }

    // Move active balance to target. Excess balance is withdrawable.
    const activeBalance = 0; // TODO Electra: get_active_balance()
    decreaseBalance(state, sourceIndex, activeBalance);
    increaseBalance(state, targetIndex, activeBalance);

    const targetValidator = state.validators.get(targetIndex);
    if (hasEth1WithdrawalCredential(targetValidator.withdrawalCredentials)) {
      targetValidator.withdrawalCredentials[0] = COMPOUNDING_WITHDRAWAL_PREFIX;
    }
    nextPendingConsolidation++;
  }

  // TODO Electra: impl slicing for ssz
  // const remainingPendingConsolidations = [];
  // state.pendingConsolidations =remainingPendingConsolidations
}