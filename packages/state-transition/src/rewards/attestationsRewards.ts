import {PubkeyIndexMap} from "@chainsafe/pubkey-index-map";
import {BeaconConfig} from "@lodestar/config";
import {
  EFFECTIVE_BALANCE_INCREMENT,
  ForkName,
  INACTIVITY_PENALTY_QUOTIENT_ALTAIR,
  MAX_EFFECTIVE_BALANCE,
  MAX_EFFECTIVE_BALANCE_ELECTRA,
  PARTICIPATION_FLAG_WEIGHTS,
  TIMELY_HEAD_FLAG_INDEX,
  TIMELY_SOURCE_FLAG_INDEX,
  TIMELY_TARGET_FLAG_INDEX,
  WEIGHT_DENOMINATOR,
  isForkPostElectra,
} from "@lodestar/params";
import {ValidatorIndex, rewards} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {EpochTransitionCache, beforeProcessEpoch} from "../cache/epochTransitionCache.js";
import {CachedBeaconStateAllForks, CachedBeaconStateAltair} from "../types.js";
import {
  FLAG_ELIGIBLE_ATTESTER,
  FLAG_PREV_HEAD_ATTESTER_UNSLASHED,
  FLAG_PREV_SOURCE_ATTESTER_UNSLASHED,
  FLAG_PREV_TARGET_ATTESTER_UNSLASHED,
  hasMarkers,
  isInInactivityLeak,
} from "../util/index.js";

/** Attestations penalty with respect to effective balance in Gwei */
type AttestationsPenalty = {target: number; source: number; effectiveBalance: number};

const defaultAttestationsReward = {head: 0, target: 0, source: 0, inclusionDelay: 0, inactivity: 0};
const defaultAttestationsPenalty = {target: 0, source: 0};

export async function computeAttestationsRewards(
  config: BeaconConfig,
  pubkey2index: PubkeyIndexMap,
  state: CachedBeaconStateAllForks,
  validatorIds?: (ValidatorIndex | string)[]
): Promise<rewards.AttestationsRewards> {
  const fork = config.getForkName(state.slot);
  if (fork === ForkName.phase0) {
    throw Error("Unsupported fork. Attestations rewards calculation is not available in phase0");
  }

  const stateAltair = state as CachedBeaconStateAltair;
  const transitionCache = beforeProcessEpoch(stateAltair);

  const [idealRewards, penalties] = computeIdealAttestationsRewardsAndPenaltiesAltair(
    config,
    stateAltair,
    transitionCache
  );
  const totalRewards = computeTotalAttestationsRewardsAltair(
    config,
    pubkey2index,
    stateAltair,
    transitionCache,
    idealRewards,
    penalties,
    validatorIds
  );

  return {idealRewards, totalRewards};
}

function computeIdealAttestationsRewardsAndPenaltiesAltair(
  config: BeaconConfig,
  state: CachedBeaconStateAllForks,
  transitionCache: EpochTransitionCache
): [rewards.IdealAttestationsReward[], AttestationsPenalty[]] {
  const baseRewardPerIncrement = transitionCache.baseRewardPerIncrement;
  const activeBalanceByIncrement = transitionCache.totalActiveStakeByIncrement;
  const fork = config.getForkName(state.slot);
  const maxEffectiveBalance = isForkPostElectra(fork) ? MAX_EFFECTIVE_BALANCE_ELECTRA : MAX_EFFECTIVE_BALANCE;
  const maxEffectiveBalanceByIncrement = Math.floor(maxEffectiveBalance / EFFECTIVE_BALANCE_INCREMENT);

  const idealRewards = Array.from({length: maxEffectiveBalanceByIncrement + 1}, (_, effectiveBalanceByIncrement) => ({
    ...defaultAttestationsReward,
    effectiveBalance: effectiveBalanceByIncrement * EFFECTIVE_BALANCE_INCREMENT,
  }));

  const attestationsPenalties: AttestationsPenalty[] = Array.from(
    {length: maxEffectiveBalanceByIncrement + 1},
    (_, effectiveBalanceByIncrement) => ({
      ...defaultAttestationsPenalty,
      effectiveBalance: effectiveBalanceByIncrement * EFFECTIVE_BALANCE_INCREMENT,
    })
  );

  for (let i = 0; i < PARTICIPATION_FLAG_WEIGHTS.length; i++) {
    const weight = PARTICIPATION_FLAG_WEIGHTS[i];

    let unslashedStakeByIncrement: number;
    let flagName: keyof rewards.IdealAttestationsReward;

    switch (i) {
      case TIMELY_SOURCE_FLAG_INDEX: {
        unslashedStakeByIncrement = transitionCache.prevEpochUnslashedStake.sourceStakeByIncrement;
        flagName = "source";
        break;
      }
      case TIMELY_TARGET_FLAG_INDEX: {
        unslashedStakeByIncrement = transitionCache.prevEpochUnslashedStake.targetStakeByIncrement;
        flagName = "target";
        break;
      }
      case TIMELY_HEAD_FLAG_INDEX: {
        unslashedStakeByIncrement = transitionCache.prevEpochUnslashedStake.headStakeByIncrement;
        flagName = "head";
        break;
      }
      default: {
        throw Error(`Unable to retrieve unslashed stake. Unknown participation flag index: ${i}`);
      }
    }

    for (
      let effectiveBalanceByIncrement = 0;
      effectiveBalanceByIncrement <= maxEffectiveBalanceByIncrement;
      effectiveBalanceByIncrement++
    ) {
      const baseReward = effectiveBalanceByIncrement * baseRewardPerIncrement;
      const rewardNumerator = baseReward * weight * unslashedStakeByIncrement;
      // Both idealReward and penalty are rounded to nearest integer. Loss of precision is minimal as unit is gwei
      const idealReward = Math.round(rewardNumerator / activeBalanceByIncrement / WEIGHT_DENOMINATOR);
      const penalty = Math.round((baseReward * weight) / WEIGHT_DENOMINATOR); // Positive number indicates penalty

      const idealAttestationsReward = idealRewards[effectiveBalanceByIncrement];
      idealAttestationsReward[flagName] = isInInactivityLeak(state) ? 0 : idealReward; // No attestations rewards during inactivity leak

      if (flagName !== "head") {
        const attestationPenalty = attestationsPenalties[effectiveBalanceByIncrement];
        attestationPenalty[flagName] = penalty;
      }
    }
  }

  return [idealRewards, attestationsPenalties];
}

// Same calculation as `getRewardsAndPenaltiesAltair` but returns the breakdown of rewards instead of aggregated
function computeTotalAttestationsRewardsAltair(
  config: BeaconConfig,
  pubkey2index: PubkeyIndexMap,
  state: CachedBeaconStateAltair,
  transitionCache: EpochTransitionCache,
  idealRewards: rewards.IdealAttestationsReward[],
  penalties: AttestationsPenalty[],
  validatorIds: (ValidatorIndex | string)[] = []
): rewards.TotalAttestationsReward[] {
  const rewards = [];
  const {flags} = transitionCache;
  const {epochCtx} = state;
  const validatorIndices = validatorIds
    .map((id) => (typeof id === "number" ? id : pubkey2index.get(fromHex(id))))
    .filter((index) => index !== undefined); // Validator indices to include in the result

  const inactivityPenaltyDenominator = config.INACTIVITY_SCORE_BIAS * INACTIVITY_PENALTY_QUOTIENT_ALTAIR;

  for (let i = 0; i < flags.length; i++) {
    if (validatorIndices.length && !validatorIndices.includes(i)) {
      continue;
    }

    const flag = flags[i];
    if (!hasMarkers(flag, FLAG_ELIGIBLE_ATTESTER)) {
      continue;
    }

    const effectiveBalanceIncrement = epochCtx.effectiveBalanceIncrements[i];

    const currentRewards = {...defaultAttestationsReward, validatorIndex: i};

    if (hasMarkers(flag, FLAG_PREV_SOURCE_ATTESTER_UNSLASHED)) {
      currentRewards.source = idealRewards[effectiveBalanceIncrement].source;
    } else {
      currentRewards.source = penalties[effectiveBalanceIncrement].source * -1; // Negative reward to indicate penalty
    }

    if (hasMarkers(flag, FLAG_PREV_TARGET_ATTESTER_UNSLASHED)) {
      currentRewards.target = idealRewards[effectiveBalanceIncrement].target;
    } else {
      currentRewards.target = penalties[effectiveBalanceIncrement].target * -1;

      // Also incur inactivity penalty if not voting target correctly
      const inactivityPenaltyNumerator =
        effectiveBalanceIncrement * EFFECTIVE_BALANCE_INCREMENT * state.inactivityScores.get(i);
      currentRewards.inactivity = Math.floor(inactivityPenaltyNumerator / inactivityPenaltyDenominator) * -1;
    }

    if (hasMarkers(flag, FLAG_PREV_HEAD_ATTESTER_UNSLASHED)) {
      currentRewards.head = idealRewards[effectiveBalanceIncrement].head;
    }

    rewards.push(currentRewards);
  }

  return rewards;
}
