import {phase0, ValidatorIndex} from "@chainsafe/lodestar-types";

import {decreaseBalance, increaseBalance} from "../../../util";
import {CachedBeaconState} from "../util";
import {initiateValidatorExit} from "./initiateValidatorExit";

export function slashValidator(
  state: CachedBeaconState<phase0.BeaconState>,
  slashedIndex: ValidatorIndex,
  whistleblowerIndex?: ValidatorIndex
): void {
  const {config, validators, epochCtx} = state;
  const {
    EPOCHS_PER_SLASHINGS_VECTOR,
    MIN_SLASHING_PENALTY_QUOTIENT,
    WHISTLEBLOWER_REWARD_QUOTIENT,
    PROPOSER_REWARD_QUOTIENT,
  } = config.params;
  const epoch = epochCtx.currentShuffling.epoch;
  initiateValidatorExit(state, slashedIndex);
  const validator = validators[slashedIndex];
  validators.update(slashedIndex, {
    slashed: true,
    withdrawableEpoch: Math.max(validator.withdrawableEpoch, epoch + EPOCHS_PER_SLASHINGS_VECTOR),
  });
  state.slashings[epoch % EPOCHS_PER_SLASHINGS_VECTOR] += validator.effectiveBalance;
  decreaseBalance(state, slashedIndex, validator.effectiveBalance / BigInt(MIN_SLASHING_PENALTY_QUOTIENT));

  // apply proposer and whistleblower rewards
  const proposerIndex = epochCtx.getBeaconProposer(state.slot);
  if (whistleblowerIndex === undefined || !Number.isSafeInteger(whistleblowerIndex)) {
    whistleblowerIndex = proposerIndex;
  }
  const whistleblowerReward = validator.effectiveBalance / BigInt(WHISTLEBLOWER_REWARD_QUOTIENT);
  const proposerReward = whistleblowerReward / BigInt(PROPOSER_REWARD_QUOTIENT);
  increaseBalance(state, proposerIndex, proposerReward);
  increaseBalance(state, whistleblowerIndex, whistleblowerReward - proposerReward);
}
