import {ValidatorIndex} from "@chainsafe/lodestar-types";
import {
  EPOCHS_PER_SLASHINGS_VECTOR,
  ForkName,
  MIN_SLASHING_PENALTY_QUOTIENT,
  MIN_SLASHING_PENALTY_QUOTIENT_ALTAIR,
  MIN_SLASHING_PENALTY_QUOTIENT_BELLATRIX,
  PROPOSER_REWARD_QUOTIENT,
  PROPOSER_WEIGHT,
  WEIGHT_DENOMINATOR,
  WHISTLEBLOWER_REWARD_QUOTIENT,
} from "@chainsafe/lodestar-params";

import {decreaseBalance, increaseBalance} from "../../util/index.js";
import {CachedBeaconStateAllForks} from "../../types.js";
import {initiateValidatorExit} from "./initiateValidatorExit.js";

export function slashValidatorAllForks(
  fork: ForkName,
  state: CachedBeaconStateAllForks,
  slashedIndex: ValidatorIndex,
  whistleblowerIndex?: ValidatorIndex
): void {
  const {epochCtx} = state;
  const epoch = epochCtx.currentShuffling.epoch;
  const validator = state.validators.get(slashedIndex);

  // TODO: Bellatrix initiateValidatorExit validators.update() with the one below
  initiateValidatorExit(state, validator);

  validator.slashed = true;
  validator.withdrawableEpoch = Math.max(validator.withdrawableEpoch, epoch + EPOCHS_PER_SLASHINGS_VECTOR);

  const {effectiveBalance} = validator;
  // TODO: could state.slashings be number?
  const slashingIndex = epoch % EPOCHS_PER_SLASHINGS_VECTOR;
  state.slashings.set(slashingIndex, state.slashings.get(slashingIndex) + BigInt(effectiveBalance));

  const minSlashingPenaltyQuotient =
    fork === ForkName.phase0
      ? MIN_SLASHING_PENALTY_QUOTIENT
      : fork === ForkName.altair
      ? MIN_SLASHING_PENALTY_QUOTIENT_ALTAIR
      : MIN_SLASHING_PENALTY_QUOTIENT_BELLATRIX;
  decreaseBalance(state, slashedIndex, Math.floor(effectiveBalance / minSlashingPenaltyQuotient));

  // apply proposer and whistleblower rewards
  const whistleblowerReward = Math.floor(effectiveBalance / WHISTLEBLOWER_REWARD_QUOTIENT);
  const proposerReward =
    fork === ForkName.phase0
      ? Math.floor(whistleblowerReward / PROPOSER_REWARD_QUOTIENT)
      : Math.floor((whistleblowerReward * PROPOSER_WEIGHT) / WEIGHT_DENOMINATOR);

  const proposerIndex = epochCtx.getBeaconProposer(state.slot);
  if (whistleblowerIndex === undefined || !Number.isSafeInteger(whistleblowerIndex)) {
    // Call increaseBalance() once with `(whistleblowerReward - proposerReward) + proposerReward`
    increaseBalance(state, proposerIndex, whistleblowerReward);
  } else {
    increaseBalance(state, proposerIndex, proposerReward);
    increaseBalance(state, whistleblowerIndex, whistleblowerReward - proposerReward);
  }
}
