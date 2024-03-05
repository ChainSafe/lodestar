import {Epoch, ValidatorIndex} from "@lodestar/types";
import {
  EFFECTIVE_BALANCE_INCREMENT,
  ForkName,
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
  EpochTransitionCache,
  beforeProcessEpoch,
  isInInactivityLeak,
} from "@lodestar/state-transition";
import {BeaconConfig} from "@lodestar/config";

export type AttestationsRewards = routes.beacon.AttestationsRewards;
type IdealAttestationsReward = routes.beacon.IdealAttestationsReward;
type TotalAttestationsReward = routes.beacon.TotalAttestationsReward;

const defaultIdealAttestionsReward = {head: 0, target: 0, source: 0, inclusionDelay: 0, inactivity: 0};

export async function computeAttestationsRewards(
  epoch: Epoch,
  state: CachedBeaconStateAllForks,
  config: BeaconConfig,
  validatorIds?: (ValidatorIndex | string)[]
): Promise<AttestationsRewards> {
  const fork = state.config.getForkName(state.slot);
  if (fork === ForkName.phase0) {
    throw Error("Unsupported fork. Attestations rewards calculation is not available in phase0");
  }

  const stateAltair = state;
  const transitionCache = beforeProcessEpoch(stateAltair);

  const attRewards = {head: 0, target: 0, source: 0, inclusionDelay: 0, inactivity: 0};
  const data = {
    idealRewards: computeIdealAttestationsRewardsAltair(stateAltair, transitionCache),
    totalRewards: [{...attRewards, validatorIndex: 0}],
  };

  return data;
}

function computeIdealAttestationsRewardsAltair(
  state: CachedBeaconStateAllForks,
  transitionCache: EpochTransitionCache
): IdealAttestationsReward[] {
  const baseRewardPerIncrement = transitionCache.baseRewardPerIncrement;
  const activeBalanceByIncrement = transitionCache.totalActiveStakeByIncrement;
  const maxEffectiveBalanceByIncrement = Math.floor(MAX_EFFECTIVE_BALANCE / EFFECTIVE_BALANCE_INCREMENT);

  const idealAttestationsRewards = Array.from(
    {length: maxEffectiveBalanceByIncrement + 1},
    (_, effectiveBalanceByIncrement) => ({
      ...defaultIdealAttestionsReward,
      effectiveBalance: effectiveBalanceByIncrement * EFFECTIVE_BALANCE_INCREMENT,
    })
  );

  // No attestations rewards during inactivity leak. Early return
  if (isInInactivityLeak(state)) {
    return idealAttestationsRewards;
  }

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

      const idealAttestationsReward: IdealAttestationsReward =
        idealAttestationsRewards[effectiveBalanceByIncrement * EFFECTIVE_BALANCE_INCREMENT];
      idealAttestationsReward[flagName] = idealReward;
    }
  }

  return idealAttestationsRewards;
}

// Same calculation as `getRewardsAndPenaltiesAltair` but returns the breakdown of rewards instead of aggregated
function computeTotalAttestationsRewardsAltair(
  state: CachedBeaconStateAllForks,
  transitionCache: EpochTransitionCache
): TotalAttestationsReward[] {}
