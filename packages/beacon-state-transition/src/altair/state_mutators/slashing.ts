import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {
  EPOCHS_PER_SLASHINGS_VECTOR,
  MIN_SLASHING_PENALTY_QUOTIENT_ALTAIR,
  PROPOSER_WEIGHT,
  WEIGHT_DENOMINATOR,
  WHISTLEBLOWER_REWARD_QUOTIENT,
} from "@chainsafe/lodestar-params";
import {altair, ValidatorIndex} from "@chainsafe/lodestar-types";
import {
  getCurrentEpoch,
  initiateValidatorExit,
  decreaseBalance,
  getBeaconProposerIndex,
  increaseBalance,
} from "../../util";

/**
 * Slash the validator with index ``slashed_index``.
 * @param config
 * @param state
 * @param slashedIndex
 * @param whistleblowerIndex
 */
export function slashValidator(
  config: IBeaconConfig,
  state: altair.BeaconState,
  slashedIndex: ValidatorIndex,
  whistleblowerIndex: ValidatorIndex | null = null
): void {
  const currentEpoch = getCurrentEpoch(state);

  initiateValidatorExit(config, state, slashedIndex);
  state.validators[slashedIndex].slashed = true;
  state.validators[slashedIndex].withdrawableEpoch = Math.max(
    state.validators[slashedIndex].withdrawableEpoch,
    currentEpoch + EPOCHS_PER_SLASHINGS_VECTOR
  );

  const slashedBalance = state.validators[slashedIndex].effectiveBalance;
  state.slashings[currentEpoch % EPOCHS_PER_SLASHINGS_VECTOR] += slashedBalance;
  decreaseBalance(
    state,
    slashedIndex,
    state.validators[slashedIndex].effectiveBalance / MIN_SLASHING_PENALTY_QUOTIENT_ALTAIR
  );

  const proposerIndex = getBeaconProposerIndex(state);
  if (whistleblowerIndex === undefined || whistleblowerIndex === null) {
    whistleblowerIndex = proposerIndex;
  }
  const whistleblowingReward = slashedBalance / WHISTLEBLOWER_REWARD_QUOTIENT;
  const proposerReward = (whistleblowingReward * PROPOSER_WEIGHT) / WEIGHT_DENOMINATOR;
  increaseBalance(state, proposerIndex, proposerReward);
  increaseBalance(state, whistleblowerIndex, whistleblowingReward - proposerReward);
}
