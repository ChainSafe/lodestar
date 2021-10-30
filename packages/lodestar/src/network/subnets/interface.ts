import {ForkName} from "@chainsafe/lodestar-params";
import {Slot, ValidatorIndex} from "@chainsafe/lodestar-types";
import {RequestedSubnet} from "../peers/utils";

/** Generic CommitteeSubscription for both beacon attnets subs and syncnets subs */
export type CommitteeSubscription = {
  validatorIndex: ValidatorIndex;
  subnet: number;
  slot: Slot;
  isAggregator: boolean;
};

export interface ISubnetsService {
  start(): void;
  stop(): void;
  addCommitteeSubscriptions(subscriptions: CommitteeSubscription[]): void;
  getActiveSubnets(): RequestedSubnet[];
  subscribeSubnetsToNextFork(nextFork: ForkName): void;
  unsubscribeSubnetsFromPrevFork(prevFork: ForkName): void;
}

export interface IAttnetsService extends ISubnetsService {
  shouldProcess(subnet: number, slot: Slot): boolean;
}

export type SubnetsServiceOpts = {
  subscribeAllSubnets?: boolean;
};
