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
  const {validators, epochCtx} = state;
  const epoch = epochCtx.currentShuffling.epoch;
  initiateValidatorExit(state as CachedBeaconState<allForks.BeaconState>, slashedIndex);
  const validator = validators[slashedIndex];
  validators.update(slashedIndex, {
    slashed: true,
    withdrawableEpoch: Math.max(validator.withdrawableEpoch, epoch + EPOCHS_PER_SLASHINGS_VECTOR),
  });

  const {effectiveBalance} = validator;
  state.slashings[epoch % EPOCHS_PER_SLASHINGS_VECTOR] += effectiveBalance;

  const minSlashingPenaltyQuotient =
    fork === ForkName.phase0 ? MIN_SLASHING_PENALTY_QUOTIENT : MIN_SLASHING_PENALTY_QUOTIENT_ALTAIR;
  decreaseBalance(state, slashedIndex, Number(effectiveBalance / minSlashingPenaltyQuotient));

  // apply proposer and whistleblower rewards
  const proposerIndex = epochCtx.getBeaconProposer(state.slot);
  if (whistleblowerIndex === undefined || !Number.isSafeInteger(whistleblowerIndex)) {
    whistleblowerIndex = proposerIndex;
  }
  // TODO: could be all number here if effectiveBalance is also number
  const whistleblowerReward = effectiveBalance / WHISTLEBLOWER_REWARD_QUOTIENT;
  const proposerReward =
    fork === ForkName.phase0
      ? whistleblowerReward / PROPOSER_REWARD_QUOTIENT
      : (whistleblowerReward * PROPOSER_WEIGHT) / WEIGHT_DENOMINATOR;

  increaseBalance(state, proposerIndex, Number(proposerReward));
  increaseBalance(state, whistleblowerIndex, Number(whistleblowerReward - proposerReward));
}
