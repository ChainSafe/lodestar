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

export function slashValidatorAllForks(
  fork: ForkName,
  state: CachedBeaconState<allForks.BeaconState>,
  slashedIndex: ValidatorIndex,
  whistleblowerIndex?: ValidatorIndex
): void {
  const {validators, epochCtx} = state;
  const epoch = epochCtx.currentShuffling.epoch;
  initiateValidatorExit(state as CachedBeaconState<allForks.BeaconState>, slashedIndex);
  const validator = validators[slashedIndex];
  validators.update(slashedIndex, {
    slashed: true,
    withdrawableEpoch: Math.max(validator.withdrawableEpoch, epoch + EPOCHS_PER_SLASHINGS_VECTOR),
  });
  state.slashings[epoch % EPOCHS_PER_SLASHINGS_VECTOR] += validator.effectiveBalance;

  if (fork === ForkName.phase0) {
    decreaseBalance(state, slashedIndex, validator.effectiveBalance / MIN_SLASHING_PENALTY_QUOTIENT);
  } else {
    decreaseBalance(state, slashedIndex, validator.effectiveBalance / MIN_SLASHING_PENALTY_QUOTIENT_ALTAIR);
  }

  // apply proposer and whistleblower rewards
  const proposerIndex = epochCtx.getBeaconProposer(state.slot);
  if (whistleblowerIndex === undefined || !Number.isSafeInteger(whistleblowerIndex)) {
    whistleblowerIndex = proposerIndex;
  }
  const whistleblowerReward = validator.effectiveBalance / WHISTLEBLOWER_REWARD_QUOTIENT;
  const proposerReward =
    fork === ForkName.phase0
      ? whistleblowerReward / PROPOSER_REWARD_QUOTIENT
      : (whistleblowerReward * PROPOSER_WEIGHT) / WEIGHT_DENOMINATOR;

  increaseBalance(state, proposerIndex, proposerReward);
  increaseBalance(state, whistleblowerIndex, whistleblowerReward - proposerReward);
}
