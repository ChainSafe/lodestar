import {getV4Crypto} from "@chainsafe/enr";
import {fromHexString} from "@chainsafe/ssz";
import type {PeerId, PrivateKey} from "@libp2p/interface";
import {peerIdFromPrivateKey} from "@libp2p/peer-id";
import {ForkName} from "@lodestar/params";
import {Bytes32, Slot, SubnetID, ValidatorIndex} from "@lodestar/types";
import {GossipTopic} from "../gossip/interface.js";
import {RequestedSubnet} from "../peers/utils/index.js";

/** Generic CommitteeSubscription for both beacon attnets subs and syncnets subs */
export type CommitteeSubscription = {
  validatorIndex: ValidatorIndex;
  subnet: SubnetID;
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
  shouldProcess(subnet: SubnetID, slot: Slot): boolean;
}

export type RandBetweenFn = (min: number, max: number) => number;
export type ShuffleFn = <T>(arr: T[]) => T[];

export type SubnetsServiceOpts = {
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
export function computeNodeIdFromPrivateKey(privateKey: PrivateKey): NodeId {
  const peerId = peerIdFromPrivateKey(privateKey);
  return computeNodeId(peerId);
}

export function computeNodeId(peerId: PeerId): Uint8Array {
  if (peerId.publicKey === undefined) {
    throw Error(`Undefined publicKey peerId=${peerId.toString()}`);
  }
  const nodeIdHex = getV4Crypto().nodeId(peerId.publicKey.raw);
  return fromHexString(nodeIdHex);
}
