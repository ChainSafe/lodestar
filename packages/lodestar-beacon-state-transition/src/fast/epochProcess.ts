import {Epoch, ValidatorIndex, Gwei} from "@chainsafe/lodestar-types";
import {intDiv} from "@chainsafe/lodestar-utils";

import {IAttesterStatus} from "./attesterStatus";
import {IEpochStakeSummary} from "./epochStakeSummary";

export interface IEpochProcess {
  prevEpoch: Epoch;
  currentEpoch: Epoch;
  statuses: IAttesterStatus[];
  totalActiveStake: Gwei;
  prevEpochUnslashedStake: IEpochStakeSummary;
  prevEpochTargetStake: Gwei;
  currEpochTargetStake: Gwei;
  indicesToSlash: ValidatorIndex[];
  indicesToSetActivationEligibility: ValidatorIndex[];
  // ignores churn, apply churn-limit manually.
  // maybe, because finality affects it still
  indicesToMaybeActivate: ValidatorIndex[];

  indicesToEject: ValidatorIndex[];
  exitQueueEnd: Epoch;
  exitQueueEndChurn: number;
  churnLimit: number;
}

export function createIEpochProcess(): IEpochProcess {
  return {
    prevEpoch: 0,
    currentEpoch: 0,
    statuses: [],
    totalActiveStake: BigInt(0),
    prevEpochUnslashedStake: {
      sourceStake: BigInt(0),
      targetStake: BigInt(0),
      headStake: BigInt(0),
    },
    prevEpochTargetStake: BigInt(0),
    currEpochTargetStake: BigInt(0),
    indicesToSlash: [],
    indicesToSetActivationEligibility: [],
    indicesToMaybeActivate: [],
    indicesToEject: [],
    exitQueueEnd: 0,
    exitQueueEndChurn: 0,
    churnLimit: 0,
  };
}
