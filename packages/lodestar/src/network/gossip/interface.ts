/**
 * @module network/gossip
 */

import {ForkName} from "@chainsafe/lodestar-params";
import {allForks, altair, phase0} from "@chainsafe/lodestar-types";
import StrictEventEmitter from "strict-event-emitter-types";
import {EventEmitter} from "events";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import LibP2p from "libp2p";
import {ILogger} from "@chainsafe/lodestar-utils";
import {InMessage} from "libp2p-interfaces/src/pubsub";
import {IBeaconChain} from "../../chain";
import {NetworkEvent} from "../events";
import {JobItemQueue} from "../../util/queue";

export enum GossipType {
  // phase0
  beacon_block = "beacon_block",
  beacon_aggregate_and_proof = "beacon_aggregate_and_proof",
  beacon_attestation = "beacon_attestation",
  voluntary_exit = "voluntary_exit",
  proposer_slashing = "proposer_slashing",
  attester_slashing = "attester_slashing",
  // altair
  sync_committee_contribution_and_proof = "sync_committee_contribution_and_proof",
  sync_committee = "sync_committee",
}

export enum GossipEncoding {
  ssz_snappy = "ssz_snappy",
}

/**
 * Note: `IGossipTopic`s are all relative to the local `genesisValidatorsRoot`
 */
export interface IGossipTopic {
  type: GossipType;
  fork: ForkName;
  encoding?: GossipEncoding;
}

export type GossipTopicTypeMap = {
  [GossipType.beacon_block]: {type: GossipType.beacon_block};
  [GossipType.beacon_aggregate_and_proof]: {type: GossipType.beacon_aggregate_and_proof};
  [GossipType.beacon_attestation]: {type: GossipType.beacon_attestation; subnet: number};
  [GossipType.voluntary_exit]: {type: GossipType.voluntary_exit};
  [GossipType.proposer_slashing]: {type: GossipType.proposer_slashing};
  [GossipType.attester_slashing]: {type: GossipType.attester_slashing};
  [GossipType.sync_committee_contribution_and_proof]: {
    type: GossipType.sync_committee_contribution_and_proof;
  };
  [GossipType.sync_committee]: {type: GossipType.sync_committee; subnet: number};
};

export type GossipTopicMap = {
  [K in keyof GossipTopicTypeMap]: GossipTopicTypeMap[K] & IGossipTopic;
};

/**
 * Gossip topic split into a struct
 */
export type GossipTopic = GossipTopicMap[keyof GossipTopicMap];

export type GossipTypeMap = {
  [GossipType.beacon_block]: allForks.SignedBeaconBlock;
  [GossipType.beacon_aggregate_and_proof]: phase0.SignedAggregateAndProof;
  [GossipType.beacon_attestation]: phase0.Attestation;
  [GossipType.voluntary_exit]: phase0.SignedVoluntaryExit;
  [GossipType.proposer_slashing]: phase0.ProposerSlashing;
  [GossipType.attester_slashing]: phase0.AttesterSlashing;
  [GossipType.sync_committee_contribution_and_proof]: altair.SignedContributionAndProof;
  [GossipType.sync_committee]: altair.SyncCommitteeMessage;
};

export type GossipFnByType = {
  [GossipType.beacon_block]: (signedBlock: allForks.SignedBeaconBlock) => Promise<void> | void;
  [GossipType.beacon_aggregate_and_proof]: (aggregateAndProof: phase0.SignedAggregateAndProof) => Promise<void> | void;
  [GossipType.beacon_attestation]: (attestation: phase0.Attestation) => Promise<void> | void;
  [GossipType.voluntary_exit]: (voluntaryExit: phase0.SignedVoluntaryExit) => Promise<void> | void;
  [GossipType.proposer_slashing]: (proposerSlashing: phase0.ProposerSlashing) => Promise<void> | void;
  [GossipType.attester_slashing]: (attesterSlashing: phase0.AttesterSlashing) => Promise<void> | void;
  [GossipType.sync_committee_contribution_and_proof]: (
    signedContributionAndProof: altair.SignedContributionAndProof
  ) => Promise<void> | void;
  [GossipType.sync_committee]: (syncCommittee: altair.SyncCommitteeMessage) => Promise<void> | void;
};

export type GossipFn = GossipFnByType[keyof GossipFnByType];

export interface IGossipEvents {
  [topicStr: string]: GossipFn;
  [NetworkEvent.gossipHeartbeat]: () => void;
  [NetworkEvent.gossipStart]: () => void;
  [NetworkEvent.gossipStop]: () => void;
}
export type GossipEventEmitter = StrictEventEmitter<EventEmitter, IGossipEvents>;

export interface IGossipModules {
  config: IBeaconConfig;
  libp2p: LibP2p;
  logger: ILogger;
  chain: IBeaconChain;
}

/**
 * Contains various methods for validation of incoming gossip topic data.
 * The conditions for valid gossip topics and how they are handled are specified here:
 * https://github.com/ethereum/eth2.0-specs/blob/dev/specs/phase0/p2p-interface.md#global-topics
 */

/**
 * Top-level type for gossip validation functions
 *
 * js-libp2p-gossipsub expects validation functions that look like this
 */
export type GossipValidatorFn = (topic: GossipTopic, message: InMessage, seenTimestampSec: number) => Promise<void>;

export type ValidatorFnsByType = {[K in GossipType]: GossipValidatorFn};

export type GossipJobQueues = {[K in GossipType]: JobItemQueue<[GossipTopic, InMessage, number], void>};

export type GossipHandlerFn = (
  object: GossipTypeMap[GossipType],
  topic: GossipTopicMap[GossipType],
  peerIdStr: string,
  seenTimestampSec: number
) => Promise<void>;
export type GossipHandlers = {
  [K in GossipType]: (
    object: GossipTypeMap[K],
    topic: GossipTopicMap[K],
    peerIdStr: string,
    seenTimestampSec: number
  ) => Promise<void>;
};

export type InMessageTimestamp = InMessage & {
  seenTimestampMs: number;
};
