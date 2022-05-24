import {
  AttesterFlags,
  FLAG_ELIGIBLE_ATTESTER,
  hasMarkers,
  IAttesterStatus,
  toAttesterFlags,
} from "../../../../src/index.js";
import {CachedBeaconStatePhase0, CachedBeaconStateAltair, EpochProcess} from "../../../../src/types.js";

/**
 * Generate an incomplete EpochProcess to simulate any network condition relevant to getAttestationDeltas
 * @param isInInactivityLeak true if in inactivity leak
 * @param flagFactors factor (0,1) of validators that have that flag set to true
 */
export function generateBalanceDeltasEpochProcess(
  state: CachedBeaconStatePhase0 | CachedBeaconStateAltair,
  isInInactivityLeak: boolean,
  flagFactors: FlagFactors
): EpochProcess {
  const vc = state.validators.length;

  const statuses = generateStatuses(state.validators.length, flagFactors);
  const eligibleValidatorIndices: number[] = [];
  for (let i = 0; i < statuses.length; i++) {
    if (hasMarkers(statuses[i].flags, FLAG_ELIGIBLE_ATTESTER)) {
      eligibleValidatorIndices.push(i);
    }
  }

  const epochProcess: Partial<EpochProcess> = {
    statuses,
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

  return epochProcess as EpochProcess;
}

export type FlagFactors = Record<keyof AttesterFlags, number> | number;

function generateStatuses(vc: number, flagFactors: FlagFactors): IAttesterStatus[] {
  const totalProposers = 32;
  const statuses = new Array<IAttesterStatus>(vc);

  for (let i = 0; i < vc; i++) {
    // Set to number to set all validators to the same value
    if (typeof flagFactors === "number") {
      statuses[i] = {
        flags: flagFactors,
        proposerIndex: i % totalProposers,
        inclusionDelay: 1 + (i % 4),
        active: true,
      };
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
        flags: toAttesterFlags(flagsObj),
        proposerIndex: i % totalProposers,
        inclusionDelay: 1 + (i % 4),
        active: true,
      };
    }
  }

  return statuses;
}
