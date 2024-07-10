import {
  AttesterFlags,
  FLAG_ELIGIBLE_ATTESTER,
  hasMarkers,
  AttesterStatus,
  toAttesterFlags,
} from "../../../src/index.js";
import {CachedBeaconStatePhase0, CachedBeaconStateAltair, EpochTransitionCache} from "../../../src/types.js";

/**
 * Generate an incomplete EpochTransitionCache to simulate any network condition relevant to getAttestationDeltas
 * @param isInInactivityLeak true if in inactivity leak
 * @param flagFactors factor (0,1) of validators that have that flag set to true
 */
export function generateBalanceDeltasEpochTransitionCache(
  state: CachedBeaconStatePhase0 | CachedBeaconStateAltair,
  isInInactivityLeak: boolean,
  flagFactors: FlagFactors
): EpochTransitionCache {
  const vc = state.validators.length;

  const {statuses, flags} = generateStatuses(state.validators.length, flagFactors);
  const eligibleValidatorIndices: number[] = [];
  for (let i = 0; i < flags.length; i++) {
    if (hasMarkers(flags[i], FLAG_ELIGIBLE_ATTESTER)) {
      eligibleValidatorIndices.push(i);
    }
  }

  const cache: Partial<EpochTransitionCache> = {
    statuses,
    flags,
    eligibleValidatorIndices,
    totalActiveStakeByIncrement: vc,
    baseRewardPerIncrement: 726,
    prevEpochUnslashedStake: {
      sourceStakeByIncrement: vc - 1,
      targetStakeByIncrement: vc - 1,
      headStakeByIncrement: vc - 1,
    },
    prevEpoch: isInInactivityLeak ? state.finalizedCheckpoint.epoch - 500 : state.finalizedCheckpoint.epoch,
  };

  return cache as EpochTransitionCache;
}

export type FlagFactors = Record<keyof AttesterFlags, number> | number;

function generateStatuses(vc: number, flagFactors: FlagFactors): {statuses: AttesterStatus[]; flags: Uint8Array} {
  const totalProposers = 32;
  const statuses = new Array<AttesterStatus>(vc);
  const flags = new Uint8Array(vc);

  for (let i = 0; i < vc; i++) {
    // Set to number to set all validators to the same value
    if (typeof flagFactors === "number") {
      statuses[i] = {
        proposerIndex: i % totalProposers,
        inclusionDelay: 1 + (i % 4),
        active: true,
      };
      flags[i] = flagFactors;
    } else {
      // Use a factor to set some validators to this flag
      const flagsObj: AttesterFlags = {
        prevSourceAttester: i < vc * flagFactors.prevSourceAttester, // 0
        prevTargetAttester: i < vc * flagFactors.prevTargetAttester, // 1
        prevHeadAttester: i < vc * flagFactors.prevHeadAttester, // 2
        currSourceAttester: i < vc * flagFactors.currSourceAttester, // 3
        currTargetAttester: i < vc * flagFactors.currTargetAttester, // 4
        currHeadAttester: i < vc * flagFactors.currHeadAttester, // 5
        unslashed: i < vc * flagFactors.unslashed, // 6
        eligibleAttester: i < vc * flagFactors.eligibleAttester, // 7
      };
      statuses[i] = {
        proposerIndex: i % totalProposers,
        inclusionDelay: 1 + (i % 4),
        active: true,
      };
      flags[i] = toAttesterFlags(flagsObj);
    }
  }

  return {statuses, flags};
}
