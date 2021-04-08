import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair, ValidatorIndex} from "@chainsafe/lodestar-types";
import {
  getCurrentEpoch,
  initiateValidatorExit,
  decreaseBalance,
  getBeaconProposerIndex,
  increaseBalance,
} from "../../util";
import {PROPOSER_WEIGHT, WEIGHT_DENOMINATOR} from "../constants";

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
  const currentEpoch = getCurrentEpoch(config, state);

  initiateValidatorExit(config, state, slashedIndex);
  state.validators[slashedIndex].slashed = true;
  state.validators[slashedIndex].withdrawableEpoch = Math.max(
    state.validators[slashedIndex].withdrawableEpoch,
    currentEpoch + config.params.EPOCHS_PER_SLASHINGS_VECTOR
  );

  const slashedBalance = state.validators[slashedIndex].effectiveBalance;
  state.slashings[currentEpoch % config.params.EPOCHS_PER_SLASHINGS_VECTOR] += slashedBalance;
  decreaseBalance(
    state,
    slashedIndex,
    state.validators[slashedIndex].effectiveBalance / BigInt(config.params.MIN_SLASHING_PENALTY_QUOTIENT_ALTAIR)
  );

  const proposerIndex = getBeaconProposerIndex(config, state);
  if (whistleblowerIndex === undefined || whistleblowerIndex === null) {
    whistleblowerIndex = proposerIndex;
  }
  const whistleblowingReward = slashedBalance / BigInt(config.params.WHISTLEBLOWER_REWARD_QUOTIENT);
  const proposerReward = (whistleblowingReward * PROPOSER_WEIGHT) / WEIGHT_DENOMINATOR;
  increaseBalance(state, proposerIndex, proposerReward);
  increaseBalance(state, whistleblowerIndex, whistleblowingReward - proposerReward);
}
