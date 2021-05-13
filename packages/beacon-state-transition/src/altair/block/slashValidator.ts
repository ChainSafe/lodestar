import {allForks, altair, ValidatorIndex} from "@chainsafe/lodestar-types";

import {decreaseBalance, increaseBalance} from "../../util";
import {CachedBeaconState} from "../../allForks/util";
import {initiateValidatorExit} from "../../allForks/block";
import {PROPOSER_WEIGHT, WEIGHT_DENOMINATOR} from "../constants";

export function slashValidator(
  state: CachedBeaconState<altair.BeaconState>,
  slashedIndex: ValidatorIndex,
  whistleblowerIndex?: ValidatorIndex
): void {
  const {config, validators, epochCtx} = state;
  const {
    EPOCHS_PER_SLASHINGS_VECTOR,
    MIN_SLASHING_PENALTY_QUOTIENT_ALTAIR,
    WHISTLEBLOWER_REWARD_QUOTIENT,
  } = config.params;
  const epoch = epochCtx.currentShuffling.epoch;
  initiateValidatorExit(state as CachedBeaconState<allForks.BeaconState>, slashedIndex);
  const validator = validators[slashedIndex];
  validators.update(slashedIndex, {
    slashed: true,
    withdrawableEpoch: Math.max(validator.withdrawableEpoch, epoch + EPOCHS_PER_SLASHINGS_VECTOR),
  });
  state.slashings[epoch % EPOCHS_PER_SLASHINGS_VECTOR] += validator.effectiveBalance;
  decreaseBalance(state, slashedIndex, validator.effectiveBalance / BigInt(MIN_SLASHING_PENALTY_QUOTIENT_ALTAIR));

  // apply proposer and whistleblower rewards
  const proposerIndex = epochCtx.getBeaconProposer(state.slot);
  if (whistleblowerIndex === undefined || !Number.isSafeInteger(whistleblowerIndex)) {
    whistleblowerIndex = proposerIndex;
  }
  const whistleblowerReward = validator.effectiveBalance / BigInt(WHISTLEBLOWER_REWARD_QUOTIENT);
  const proposerReward = (whistleblowerReward * PROPOSER_WEIGHT) / WEIGHT_DENOMINATOR;
  increaseBalance(state, proposerIndex, proposerReward);
  increaseBalance(state, whistleblowerIndex, whistleblowerReward - proposerReward);
}
