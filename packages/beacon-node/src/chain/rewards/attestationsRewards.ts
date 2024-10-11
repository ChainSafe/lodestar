import {Epoch, ValidatorIndex} from "@lodestar/types";
import {
  EFFECTIVE_BALANCE_INCREMENT,
  ForkName,
  INACTIVITY_PENALTY_QUOTIENT_ALTAIR,
  MAX_EFFECTIVE_BALANCE,
  PARTICIPATION_FLAG_WEIGHTS,
  TIMELY_HEAD_FLAG_INDEX,
  TIMELY_SOURCE_FLAG_INDEX,
  TIMELY_TARGET_FLAG_INDEX,
  WEIGHT_DENOMINATOR,
} from "@lodestar/params";
import {routes} from "@lodestar/api";
import {
  CachedBeaconStateAllForks,
  CachedBeaconStateAltair,
  EpochTransitionCache,
  FLAG_ELIGIBLE_ATTESTER,
  FLAG_PREV_HEAD_ATTESTER_UNSLASHED,
  FLAG_PREV_SOURCE_ATTESTER_UNSLASHED,
  FLAG_PREV_TARGET_ATTESTER_UNSLASHED,
  beforeProcessEpoch,
  hasMarkers,
  isInInactivityLeak,
} from "@lodestar/state-transition";
import {BeaconConfig} from "@lodestar/config";
import {fromHex} from "@lodestar/utils";

export type AttestationsRewards = routes.beacon.AttestationsRewards;
type IdealAttestationsReward = routes.beacon.IdealAttestationsReward;
type TotalAttestationsReward = routes.beacon.TotalAttestationsReward;
/** Attestations penalty with respect to effective balance in Gwei */
type AttestationsPenalty = {target: number; source: number; effectiveBalance: number};

const defaultAttestationsReward = {head: 0, target: 0, source: 0, inclusionDelay: 0, inactivity: 0};
const defaultAttestationsPenalty = {target: 0, source: 0};

export async function computeAttestationsRewards(
  _epoch: Epoch,
  state: CachedBeaconStateAllForks,
  _config: BeaconConfig,
  validatorIds?: (ValidatorIndex | string)[]
): Promise<AttestationsRewards> {
  const fork = state.config.getForkName(state.slot);
  if (fork === ForkName.phase0) {
    throw Error("Unsupported fork. Attestations rewards calculation is not available in phase0");
  }

  const stateAltair = state as CachedBeaconStateAltair;
  const transitionCache = beforeProcessEpoch(stateAltair);

  const [idealRewards, penalties] = computeIdealAttestationsRewardsAndPenaltiesAltair(stateAltair, transitionCache);
  const totalRewards = computeTotalAttestationsRewardsAltair(
    stateAltair,
    transitionCache,
    idealRewards,
    penalties,
    validatorIds
  );

  return {idealRewards, totalRewards};
}

function computeIdealAttestationsRewardsAndPenaltiesAltair(
  state: CachedBeaconStateAllForks,
  transitionCache: EpochTransitionCache
): [IdealAttestationsReward[], AttestationsPenalty[]] {
  const baseRewardPerIncrement = transitionCache.baseRewardPerIncrement;
  const activeBalanceByIncrement = transitionCache.totalActiveStakeByIncrement;
  const maxEffectiveBalanceByIncrement = Math.floor(MAX_EFFECTIVE_BALANCE / EFFECTIVE_BALANCE_INCREMENT);

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

    let unslashedStakeByIncrement;
    let flagName: keyof IdealAttestationsReward;

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
      const idealReward = rewardNumerator / activeBalanceByIncrement / WEIGHT_DENOMINATOR;
      const penalty = (baseReward * weight) / WEIGHT_DENOMINATOR; // Positive number indicates penalty

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
  state: CachedBeaconStateAltair,
  transitionCache: EpochTransitionCache,
  idealRewards: IdealAttestationsReward[],
  penalties: AttestationsPenalty[],
  validatorIds: (ValidatorIndex | string)[] = []
): TotalAttestationsReward[] {
  const rewards = [];
  const {flags} = transitionCache;
  const {epochCtx, config} = state;
  const validatorIndices = validatorIds
    .map((id) => (typeof id === "number" ? id : epochCtx.pubkey2index.get(fromHex(id))))
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
