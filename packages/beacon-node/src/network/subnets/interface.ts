import {ForkName} from "@lodestar/params";
import {Bytes32, Slot, ValidatorIndex} from "@lodestar/types";
import {RequestedSubnet} from "../peers/utils/index.js";
import {GossipTopic} from "../gossip/interface.js";

/** Generic CommitteeSubscription for both beacon attnets subs and syncnets subs */
export type CommitteeSubscription = {
  validatorIndex: ValidatorIndex;
  subnet: number;
  slot: Slot;
  isAggregator: boolean;
};

export type SubnetsService = {
  close(): void;
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
  deterministicLongLivedAttnets?: boolean;
  subscribeAllSubnets?: boolean;
  slotsToSubscribeBeforeAggregatorDuty: number;
};

export type SubnetsServiceTestOpts = {
  // For deterministic randomness in unit test after ESM prevents simple import mocking
  randBetweenFn?: RandBetweenFn;
  shuffleFn?: ShuffleFn;
};

type TopicStr = string;
type PeerIdStr = string;

export type GossipSubscriber = {
  subscribeTopic(topic: GossipTopic): void;
  unsubscribeTopic(topic: GossipTopic): void;
  mesh: Map<TopicStr, Set<PeerIdStr>>;
};

// uint256 in the spec
export type NodeId = Bytes32;
