import {
  EJECTION_INACTIVITY_SCORE,
  FINALITY_FLAG_INDEX,
  ForkSeq,
  PARTICIPATION_FLAG_WEIGHTS_EIP8453,
  PROGRESS_FLAG_INDEX,
  WEIGHT_DENOMINATOR,
} from "@lodestar/params";
import {initiateValidatorExit} from "../block/initiateValidatorExit.js";
import {CachedBeaconStateEip8453} from "../types.js";
import {
  getRoundRewardPerIncrement,
  getUnslashedParticipatingIndicesEip8453,
  isInInactivityLeakEip8453,
} from "../util/eip8453.js";

/**
 * Spec: process_round
 * A round is to the finality gadget what an epoch is to Casper FFG: each active validator attests once, and the
 * gadget settles rewards and inactivity at its end.
 */
export function processRound(state: CachedBeaconStateEip8453): void {
  const roundParticipation = state.roundParticipation.getAll();
  processInactivityUpdatesEip8453(state, roundParticipation);
  processRewardsEip8453(state, roundParticipation);
  processParticipationFlagUpdatesEip8453(state);
}

/**
 * Spec: process_inactivity_updates [Modified in EIP8453]
 * A virtual penalty: inactivity costs weight in finality gadget quorums instead of balance, and a validator whose
 * score reaches EJECTION_INACTIVITY_SCORE is exited and keeps its stake. Scores are updated every round.
 */
export function processInactivityUpdatesEip8453(state: CachedBeaconStateEip8453, roundParticipation: number[]): void {
  const {config, epochCtx} = state;
  const {INACTIVITY_SCORE_BIAS, INACTIVITY_SCORE_RECOVERY_RATE} = config;
  const progressFlag = 1 << PROGRESS_FLAG_INDEX;
  const validators = state.validators;
  const inactivityScores = state.inactivityScores.getAll();
  let changed = false;

  for (const index of epochCtx.currentShuffling.activeIndices) {
    const participating =
      (roundParticipation[index] & progressFlag) === progressFlag && !validators.getReadonly(index).slashed;
    const score = inactivityScores[index];
    if (participating) {
      const next = score - Math.min(score, INACTIVITY_SCORE_RECOVERY_RATE);
      if (next !== score) {
        inactivityScores[index] = next;
        changed = true;
      }
    } else {
      inactivityScores[index] = score + INACTIVITY_SCORE_BIAS;
      changed = true;
      if (inactivityScores[index] >= EJECTION_INACTIVITY_SCORE) {
        initiateValidatorExit(ForkSeq.eip8453, state, validators.get(index));
      }
    }
  }

  if (changed) {
    state.inactivityScores = state.type.fields.inactivityScores.toViewDU(inactivityScores);
  }
}

/**
 * Spec: get_flag_index_rewards
 * A validator without the flag forfeits the reward and is not penalized, and no rewards are paid during an
 * inactivity leak.
 */
export function getFlagIndexRewardsEip8453(
  state: CachedBeaconStateEip8453,
  flagIndex: number,
  roundParticipation: number[],
  rewardPerIncrement: number
): number[] {
  const {epochCtx} = state;
  const {effectiveBalanceIncrements} = epochCtx;
  const rewards = new Array<number>(state.validators.length).fill(0);
  if (isInInactivityLeakEip8453(state)) {
    return rewards;
  }
  const participatingIndices = getUnslashedParticipatingIndicesEip8453(state, flagIndex, roundParticipation);
  const weight = PARTICIPATION_FLAG_WEIGHTS_EIP8453[flagIndex];
  let participatingIncrements = 0;
  for (const index of participatingIndices) {
    participatingIncrements += effectiveBalanceIncrements[index];
  }
  // get_total_balance floors at EFFECTIVE_BALANCE_INCREMENT
  participatingIncrements = Math.max(participatingIncrements, 1);
  const activeIncrements = epochCtx.totalActiveBalanceIncrements;
  const rewardDenominator = activeIncrements * WEIGHT_DENOMINATOR;
  for (const index of participatingIndices) {
    const baseReward = effectiveBalanceIncrements[index] * rewardPerIncrement;
    rewards[index] += Math.floor((baseReward * weight * participatingIncrements) / rewardDenominator);
  }
  return rewards;
}

/** Spec: process_rewards, replaces process_rewards_and_penalties since inactivity is no longer penalized */
export function processRewardsEip8453(state: CachedBeaconStateEip8453, roundParticipation: number[]): void {
  const rewardPerIncrement = getRoundRewardPerIncrement(state);
  const balances = state.balances.getAll();
  let changed = false;
  for (const flagIndex of [PROGRESS_FLAG_INDEX, FINALITY_FLAG_INDEX]) {
    const rewards = getFlagIndexRewardsEip8453(state, flagIndex, roundParticipation, rewardPerIncrement);
    for (let i = 0; i < rewards.length; i++) {
      if (rewards[i] !== 0) {
        balances[i] += rewards[i];
        changed = true;
      }
    }
  }
  if (changed) {
    state.balances = state.type.fields.balances.toViewDU(balances);
  }
}

/**
 * Spec: process_participation_flag_updates [Modified in EIP8453]
 * Progress already made at the current height carries into the new round, since a validator cannot vote again
 * while a height lasts across rounds.
 */
export function processParticipationFlagUpdatesEip8453(state: CachedBeaconStateEip8453): void {
  const progressParticipation = state.progressParticipation.getAll();
  const progressFlag = 1 << PROGRESS_FLAG_INDEX;
  const flags = new Array<number>(progressParticipation.length);
  for (let i = 0; i < progressParticipation.length; i++) {
    flags[i] = progressParticipation[i] ? progressFlag : 0;
  }
  state.roundParticipation = state.type.fields.roundParticipation.toViewDU(flags);
}
