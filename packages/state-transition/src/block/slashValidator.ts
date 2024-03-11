import {ValidatorIndex} from "@lodestar/types";
import {
  EFFECTIVE_BALANCE_INCREMENT,
  EPOCHS_PER_SLASHINGS_VECTOR,
  ForkSeq,
  MIN_SLASHING_PENALTY_QUOTIENT,
  MIN_SLASHING_PENALTY_QUOTIENT_ALTAIR,
  MIN_SLASHING_PENALTY_QUOTIENT_BELLATRIX,
  PROPOSER_REWARD_QUOTIENT,
  PROPOSER_WEIGHT,
  TIMELY_TARGET_FLAG_INDEX,
  WEIGHT_DENOMINATOR,
  WHISTLEBLOWER_REWARD_QUOTIENT,
} from "@lodestar/params";

import {decreaseBalance, increaseBalance} from "../util/index.js";
import {CachedBeaconStateAllForks, CachedBeaconStateAltair} from "../types.js";
import {initiateValidatorExit} from "./initiateValidatorExit.js";

/** Same to https://github.com/ethereum/eth2.0-specs/blob/v1.1.0-alpha.5/specs/altair/beacon-chain.md#has_flag */
const TIMELY_TARGET = 1 << TIMELY_TARGET_FLAG_INDEX;

export function slashValidator(
  fork: ForkSeq,
  state: CachedBeaconStateAllForks,
  slashedIndex: ValidatorIndex,
  whistleblowerIndex?: ValidatorIndex
): void {
  const {epochCtx} = state;
  const {epoch, effectiveBalanceIncrements} = epochCtx;
  const validator = state.validators.get(slashedIndex);

  // TODO: Bellatrix initiateValidatorExit validators.update() with the one below
  initiateValidatorExit(state, validator);

  validator.slashed = true;
  validator.withdrawableEpoch = Math.max(validator.withdrawableEpoch, epoch + EPOCHS_PER_SLASHINGS_VECTOR);

  const {effectiveBalance} = validator;

  // state.slashings is initially a Gwei (BigInt) vector, however since Nov 2023 it's converted to UintNum64 (number) vector in the state transition because:
  //  - state.slashings[nextEpoch % EPOCHS_PER_SLASHINGS_VECTOR] is reset per epoch in processSlashingsReset()
  //  - max slashed validators per epoch is SLOTS_PER_EPOCH * MAX_ATTESTER_SLASHINGS * MAX_VALIDATORS_PER_COMMITTEE which is 32 * 2 * 2048 = 131072 on mainnet
  //  - with that and 32_000_000_000 MAX_EFFECTIVE_BALANCE, it still fits in a number given that Math.floor(Number.MAX_SAFE_INTEGER / 32_000_000_000) = 281474
  //  - we don't need to compute the total slashings from state.slashings, it's handled by totalSlashingsByIncrement in EpochCache
  const slashingIndex = epoch % EPOCHS_PER_SLASHINGS_VECTOR;
  state.slashings.set(slashingIndex, (state.slashings.get(slashingIndex) ?? 0) + effectiveBalance);
  epochCtx.totalSlashingsByIncrement += effectiveBalanceIncrements[slashedIndex];

  const minSlashingPenaltyQuotient =
    fork === ForkSeq.phase0
      ? MIN_SLASHING_PENALTY_QUOTIENT
      : fork === ForkSeq.altair
        ? MIN_SLASHING_PENALTY_QUOTIENT_ALTAIR
        : MIN_SLASHING_PENALTY_QUOTIENT_BELLATRIX;
  decreaseBalance(state, slashedIndex, Math.floor(effectiveBalance / minSlashingPenaltyQuotient));

  // apply proposer and whistleblower rewards
  const whistleblowerReward = Math.floor(effectiveBalance / WHISTLEBLOWER_REWARD_QUOTIENT);
  const proposerReward =
    fork === ForkSeq.phase0
      ? Math.floor(whistleblowerReward / PROPOSER_REWARD_QUOTIENT)
      : Math.floor((whistleblowerReward * PROPOSER_WEIGHT) / WEIGHT_DENOMINATOR);

  const proposerIndex = epochCtx.getBeaconProposer(state.slot);
  if (whistleblowerIndex === undefined || !Number.isSafeInteger(whistleblowerIndex)) {
    // Call increaseBalance() once with `(whistleblowerReward - proposerReward) + proposerReward`
    increaseBalance(state, proposerIndex, whistleblowerReward);
    state.proposerRewards.slashing += whistleblowerReward;
  } else {
    increaseBalance(state, proposerIndex, proposerReward);
    increaseBalance(state, whistleblowerIndex, whistleblowerReward - proposerReward);
    state.proposerRewards.slashing += proposerReward;
  }

  // TODO: describe issue. Compute progressive target balances
  // if a validator is slashed, lookup their participation and remove from the cumulative values
  if (fork >= ForkSeq.altair) {
    const {previousEpochParticipation, currentEpochParticipation} = state as CachedBeaconStateAltair;

    if ((previousEpochParticipation.get(slashedIndex) & TIMELY_TARGET) === TIMELY_TARGET) {
      state.epochCtx.previousTargetUnslashedBalanceIncrements -= Math.floor(
        effectiveBalance / EFFECTIVE_BALANCE_INCREMENT
      );
    }
    if ((currentEpochParticipation.get(slashedIndex) & TIMELY_TARGET) === TIMELY_TARGET) {
      state.epochCtx.currentTargetUnslashedBalanceIncrements -= Math.floor(
        effectiveBalance / EFFECTIVE_BALANCE_INCREMENT
      );
    }
  }
}
