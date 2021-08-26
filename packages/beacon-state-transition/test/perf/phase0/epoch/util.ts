import {EFFECTIVE_BALANCE_INCREMENT, MAX_EFFECTIVE_BALANCE} from "@chainsafe/lodestar-params";
import {phase0, altair} from "../../../../src";
import {
  AttesterFlags,
  CachedBeaconState,
  IAttesterStatus,
  IEpochProcess,
  toAttesterFlags,
} from "../../../../src/allForks";

/**
 * Generate an incomplete IEpochProcess to simulate any network condition relevant to getAttestationDeltas
 * @param isInInactivityLeak true if in inactivity leak
 * @param flagFactors factor (0,1) of validators that have that flag set to true
 */
export function generateBalanceDeltasEpochProcess(
  state: CachedBeaconState<phase0.BeaconState> | CachedBeaconState<altair.BeaconState>,
  isInInactivityLeak: boolean,
  flagFactors: FlagFactors
): IEpochProcess {
  const vc = state.validators.length;
  const vcBn = BigInt(vc);

  const epochProcess: Partial<IEpochProcess> = {
    balancesFlat: state.balances.valueOf() as bigint[],
    statusesFlat: generateStatuses(vc, flagFactors),
    totalActiveStake: MAX_EFFECTIVE_BALANCE * vcBn,
    baseRewardPerIncrement: BigInt(726),
    prevEpochUnslashedStake: {
      sourceStake: MAX_EFFECTIVE_BALANCE * vcBn - EFFECTIVE_BALANCE_INCREMENT,
      targetStake: MAX_EFFECTIVE_BALANCE * vcBn - EFFECTIVE_BALANCE_INCREMENT,
      headStake: MAX_EFFECTIVE_BALANCE * vcBn - EFFECTIVE_BALANCE_INCREMENT,
    },
    prevEpoch: isInInactivityLeak ? state.finalizedCheckpoint.epoch - 500 : state.finalizedCheckpoint.epoch,
  };

  return epochProcess as IEpochProcess;
}

export type FlagFactors = Record<keyof AttesterFlags, number> | number;

function generateStatuses(vc: number, flagFactors: FlagFactors): IAttesterStatus[] {
  const totalProposers = 32;
  const statuses: IAttesterStatus[] = [];

  for (let i = 0; i < vc; i++) {
    // Set to number to set all validators to the same value
    if (typeof flagFactors === "number") {
      statuses.push({
        flags: flagFactors,
        proposerIndex: i % totalProposers,
        inclusionDelay: 1 + (i % 4),
        active: true,
      });
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
      statuses.push({
        flags: toAttesterFlags(flagsObj),
        proposerIndex: i % totalProposers,
        inclusionDelay: 1 + (i % 4),
        active: true,
      });
    }
  }

  return statuses;
}
