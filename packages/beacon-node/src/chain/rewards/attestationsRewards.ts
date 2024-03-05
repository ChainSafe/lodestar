import {Epoch, ValidatorIndex, allForks, altair, phase0} from "@lodestar/types";
import {EFFECTIVE_BALANCE_INCREMENT, ForkName, ForkSeq, MAX_EFFECTIVE_BALANCE, PARTICIPATION_FLAG_WEIGHTS, TIMELY_HEAD_FLAG_INDEX, TIMELY_SOURCE_FLAG_INDEX, TIMELY_TARGET_FLAG_INDEX, WEIGHT_DENOMINATOR, WHISTLEBLOWER_REWARD_QUOTIENT} from "@lodestar/params";
import {routes} from "@lodestar/api";
import { BeaconStateAllForks, BeaconStateAltair, CachedBeaconStateAllForks, EpochTransitionCache, beforeProcessEpoch, isInInactivityLeak} from "@lodestar/state-transition";
import { BeaconConfig } from "@lodestar/config";
import {ethToGwei} from "@lodestar/utils";
import { TotalAttestationsReward } from "@lodestar/api/lib/beacon/routes/beacon";

export type AttestationsRewards = routes.beacon.AttestationsRewards;
type IdealAttestationsReward = routes.beacon.IdealAttestationsReward;

const defaultIdealAttestionsReward = {head: 0, target: 0, source: 0, inclusionDelay: 0, inactivity: 0};


export async function computeAttestationsRewards(
  epoch: Epoch,
  state: CachedBeaconStateAllForks,
  config: BeaconConfig,
  validatorIds?: (ValidatorIndex | string)[],
): Promise<AttestationsRewards> {

  const fork = state.config.getForkName(state.slot);
  if (fork === ForkName.phase0) {
    throw Error("Unsupported fork. Attestations rewards calculation is not available in phase0");
  }

  const stateAltair = state as CachedBeaconStateAllForks;
  const transitionCache = beforeProcessEpoch(stateAltair);

  const attRewards = {head: 0, target: 0, source: 0, inclusionDelay: 0, inactivity: 0};
  const data = {
    idealRewards: computeIdealAttestationsRewardsAltair(stateAltair, transitionCache),
    totalRewards: [{...attRewards, validatorIndex: 0}],
  };

  return data;
}


function computeIdealAttestationsRewardsAltair(state: CachedBeaconStateAllForks, transitionCache: EpochTransitionCache): IdealAttestationsReward[] {
  const baseRewardPerIncrement = transitionCache.baseRewardPerIncrement;
  const activeBalanceByIncrement = transitionCache.totalActiveStakeByIncrement;
  const maxEffectiveBalanceByIncrement = Math.floor(MAX_EFFECTIVE_BALANCE / EFFECTIVE_BALANCE_INCREMENT);

  const idealAttestationsRewards = Array.from({length: maxEffectiveBalanceByIncrement + 1}, (_, index) => ({...defaultIdealAttestionsReward, effectiveBalance: index}));

  // No attestations rewards during inactivity leak. Early return
  if (isInInactivityLeak(state)) {
    return idealAttestationsRewards;
  }

  for (let i = 0; i < PARTICIPATION_FLAG_WEIGHTS.length; i++) {
    const weight = PARTICIPATION_FLAG_WEIGHTS[i];

    let unslashedStakeByIncrement;
    let flagName: keyof IdealAttestationsReward;

    switch(i) {
      case TIMELY_SOURCE_FLAG_INDEX: {
        unslashedStakeByIncrement = transitionCache.prevEpochUnslashedStake.sourceStakeByIncrement;       
        flagName = "source";
        break;
      };
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

    for (let effectiveBalanceEth = 0; effectiveBalanceEth <= maxEffectiveBalanceByIncrement; effectiveBalanceEth++) {
      const baseReward = effectiveBalanceEth * baseRewardPerIncrement;
      const rewardNumerator = baseReward * weight * unslashedStakeByIncrement;
      const idealReward = rewardNumerator / activeBalanceByIncrement / WEIGHT_DENOMINATOR;

      const idealAttestationsReward: IdealAttestationsReward = idealAttestationsRewards[effectiveBalanceEth];
      idealAttestationsReward[flagName] = idealReward;
    }
  }

  return idealAttestationsRewards;
}

function computeTotalAttestationsRewardsAltair(state: CachedBeaconStateAllForks, transitionCache: EpochTransitionCache): TotalAttestationsReward[] {


}