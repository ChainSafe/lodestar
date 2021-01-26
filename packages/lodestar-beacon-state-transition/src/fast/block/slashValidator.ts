import {ValidatorIndex} from "@chainsafe/lodestar-types";

import {decreaseBalance, increaseBalance} from "../../util";
import {CachedBeaconState} from "../util/cachedBeaconState";
import {initiateValidatorExit} from "./initiateValidatorExit";

export function slashValidator(
  cachedState: CachedBeaconState,
  slashedIndex: ValidatorIndex,
  whistleblowerIndex?: ValidatorIndex
): void {
  const {
    EPOCHS_PER_SLASHINGS_VECTOR,
    MIN_SLASHING_PENALTY_QUOTIENT,
    WHISTLEBLOWER_REWARD_QUOTIENT,
    PROPOSER_REWARD_QUOTIENT,
  } = cachedState.config.params;
  const epoch = cachedState.currentShuffling.epoch;
  initiateValidatorExit(cachedState, slashedIndex);
  const validator = cachedState.validators[slashedIndex];
  cachedState.updateValidator(slashedIndex, {
    slashed: true,
    withdrawableEpoch: Math.max(validator.withdrawableEpoch, epoch + EPOCHS_PER_SLASHINGS_VECTOR),
  });
  cachedState.slashings[epoch % EPOCHS_PER_SLASHINGS_VECTOR] += validator.effectiveBalance;
  decreaseBalance(cachedState, slashedIndex, validator.effectiveBalance / BigInt(MIN_SLASHING_PENALTY_QUOTIENT));

  // apply proposer and whistleblower rewards
  const proposerIndex = cachedState.getBeaconProposer(cachedState.slot);
  if (whistleblowerIndex === undefined || !Number.isSafeInteger(whistleblowerIndex)) {
    whistleblowerIndex = proposerIndex;
  }
  const whistleblowerReward = validator.effectiveBalance / BigInt(WHISTLEBLOWER_REWARD_QUOTIENT);
  const proposerReward = whistleblowerReward / BigInt(PROPOSER_REWARD_QUOTIENT);
  increaseBalance(cachedState, proposerIndex, proposerReward);
  increaseBalance(cachedState, whistleblowerIndex, whistleblowerReward - proposerReward);
}
