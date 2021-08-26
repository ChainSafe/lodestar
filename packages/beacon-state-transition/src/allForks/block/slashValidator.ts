import {allForks, ValidatorIndex} from "@chainsafe/lodestar-types";
import {
  EPOCHS_PER_SLASHINGS_VECTOR,
  ForkName,
  MIN_SLASHING_PENALTY_QUOTIENT,
  MIN_SLASHING_PENALTY_QUOTIENT_ALTAIR,
  PROPOSER_REWARD_QUOTIENT,
  PROPOSER_WEIGHT,
  WEIGHT_DENOMINATOR,
  WHISTLEBLOWER_REWARD_QUOTIENT,
} from "@chainsafe/lodestar-params";

import {decreaseBalance, increaseBalance} from "../../util";
import {CachedBeaconState} from "../util";
import {initiateValidatorExit} from ".";
import {BlockProcess} from "../../util/blockProcess";

export function slashValidatorAllForks(
  fork: ForkName,
  state: CachedBeaconState<allForks.BeaconState>,
  slashedIndex: ValidatorIndex,
  blockProcess: BlockProcess,
  whistleblowerIndex?: ValidatorIndex
): void {
  const {epochCtx} = state;
  const epoch = epochCtx.currentShuffling.epoch;
  const validator = state.validators[slashedIndex];

  // TODO: Merge initiateValidatorExit validators.update() with the one below
  initiateValidatorExit(state as CachedBeaconState<allForks.BeaconState>, validator);

  validator.slashed = true;
  validator.withdrawableEpoch = Math.max(validator.withdrawableEpoch, epoch + EPOCHS_PER_SLASHINGS_VECTOR);

  // TODO: Use effectiveBalance array
  const {effectiveBalance} = validator;
  state.slashings[epoch % EPOCHS_PER_SLASHINGS_VECTOR] += effectiveBalance;

  const minSlashingPenaltyQuotient =
    fork === ForkName.phase0 ? MIN_SLASHING_PENALTY_QUOTIENT : MIN_SLASHING_PENALTY_QUOTIENT_ALTAIR;
  decreaseBalance(state, slashedIndex, effectiveBalance / minSlashingPenaltyQuotient);

  // apply proposer and whistleblower rewards
  const whistleblowerReward = effectiveBalance / WHISTLEBLOWER_REWARD_QUOTIENT;
  const proposerReward =
    fork === ForkName.phase0
      ? whistleblowerReward / PROPOSER_REWARD_QUOTIENT
      : (whistleblowerReward * PROPOSER_WEIGHT) / WEIGHT_DENOMINATOR;

  const proposerIndex = epochCtx.getBeaconProposer(state.slot);
  if (whistleblowerIndex === undefined || !Number.isSafeInteger(whistleblowerIndex)) {
    // Call increaseBalance() once with `(whistleblowerReward - proposerReward) + proposerReward`
    increaseBalance(state, proposerIndex, whistleblowerReward);
  } else {
    increaseBalance(state, proposerIndex, proposerReward);
    increaseBalance(state, whistleblowerIndex, whistleblowerReward - proposerReward);
  }
}
