import {ForkName} from "@lodestar/params";
import {Slot, ValidatorIndex} from "@lodestar/types";
import {RequestedSubnet} from "../peers/utils/index.js";

/** Generic CommitteeSubscription for both beacon attnets subs and syncnets subs */
export type CommitteeSubscription = {
  validatorIndex: ValidatorIndex;
  subnet: number;
  slot: Slot;
  isAggregator: boolean;
};

export type SubnetsService = {
  start(): void;
  stop(): void;
  addCommitteeSubscriptions(subscriptions: CommitteeSubscription[]): void;
  getActiveSubnets(): RequestedSubnet[];
  subscribeSubnetsToNextFork(nextFork: ForkName): void;
  unsubscribeSubnetsFromPrevFork(prevFork: ForkName): void;
};

export interface IAttnetsService extends SubnetsService {
  shouldProcess(subnet: number, slot: Slot): boolean;
}

export type RandBetweenFn = (min: number, max: number) => number;
export type ShuffleFn = <T>(arr: T[]) => T[];

export type SubnetsServiceOpts = {
  subscribeAllSubnets?: boolean;
  // For deterministic randomness in unit test after ESM prevents simple import mocking
  randBetweenFn?: RandBetweenFn;
  shuffleFn?: ShuffleFn;
};
