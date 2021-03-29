/**
 * @module network/gossip
 */

import {phase0} from "@chainsafe/lodestar-types";
import StrictEventEmitter from "strict-event-emitter-types";
import {EventEmitter} from "events";
import {IBeaconConfig, IForkName} from "@chainsafe/lodestar-config";
import LibP2p from "libp2p";
import {ILogger} from "@chainsafe/lodestar-utils";
import {InMessage} from "libp2p-interfaces/src/pubsub";
import {IBeaconChain} from "../../chain";
import {NetworkEvent} from "../events";
import {IBeaconDb} from "../../db";

export enum GossipType {
  beacon_block = "beacon_block",
  beacon_aggregate_and_proof = "beacon_aggregate_and_proof",
  beacon_attestation = "beacon_attestation",
  voluntary_exit = "voluntary_exit",
  proposer_slashing = "proposer_slashing",
  attester_slashing = "attester_slashing",
}

export enum GossipEncoding {
  ssz = "ssz",
  ssz_snappy = "ssz_snappy",
}

/**
 * Note: `IGossipTopic`s are all relative to the local `genesisValidatorsRoot`
 */
export interface IGossipTopic {
  type: GossipType;
  fork: IForkName;
  encoding?: GossipEncoding;
}

export type GossipTopicMap = {
  [GossipType.beacon_block]: IGossipTopic & {type: GossipType.beacon_block};
  [GossipType.beacon_aggregate_and_proof]: IGossipTopic & {type: GossipType.beacon_aggregate_and_proof};
  [GossipType.beacon_attestation]: IGossipTopic & {type: GossipType.beacon_attestation; subnet: number};
  [GossipType.voluntary_exit]: IGossipTopic & {type: GossipType.voluntary_exit};
  [GossipType.proposer_slashing]: IGossipTopic & {type: GossipType.proposer_slashing};
  [GossipType.attester_slashing]: IGossipTopic & {type: GossipType.attester_slashing};
};

/**
 * Gossip topic split into a struct
 */
export type GossipTopic = GossipTopicMap[keyof GossipTopicMap];

export type GossipTypeMap = {
  [GossipType.beacon_block]: phase0.SignedBeaconBlock;
  [GossipType.beacon_aggregate_and_proof]: phase0.SignedAggregateAndProof;
  [GossipType.beacon_attestation]: phase0.Attestation;
  [GossipType.voluntary_exit]: phase0.SignedVoluntaryExit;
  [GossipType.proposer_slashing]: phase0.ProposerSlashing;
  [GossipType.attester_slashing]: phase0.AttesterSlashing;
};

export type GossipFnByType = {
  [GossipType.beacon_block]: (signedBlock: phase0.SignedBeaconBlock) => Promise<void> | void;
  [GossipType.beacon_aggregate_and_proof]: (aggregateAndProof: phase0.SignedAggregateAndProof) => Promise<void> | void;
  [GossipType.beacon_attestation]: (attestation: phase0.Attestation) => Promise<void> | void;
  [GossipType.voluntary_exit]: (voluntaryExit: phase0.SignedVoluntaryExit) => Promise<void> | void;
  [GossipType.proposer_slashing]: (proposerSlashing: phase0.ProposerSlashing) => Promise<void> | void;
  [GossipType.attester_slashing]: (attesterSlashing: phase0.AttesterSlashing) => Promise<void> | void;
};

export type GossipFn = GossipFnByType[keyof GossipFnByType];

export interface IGossipEvents {
  [topic: string]: GossipFn;
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

export type GossipObject =
  | phase0.SignedBeaconBlock
  | phase0.SignedAggregateAndProof
  | phase0.Attestation
  | phase0.SignedVoluntaryExit
  | phase0.ProposerSlashing
  | phase0.AttesterSlashing;

export type GossipHandlerFn = (gossipObject: GossipObject) => Promise<void> | void;

export type GossipSerializer = (obj: GossipObject) => Uint8Array;

export type GossipDeserializer = (buf: Uint8Array) => GossipObject;

export interface IObjectValidatorModules {
  chain: IBeaconChain;
  db: IBeaconDb;
  config: IBeaconConfig;
  logger: ILogger;
}

/**
 * Top-level type for gossip validation functions
 *
 * js-libp2p-gossipsub expects validation functions that look like this
 */
export type TopicValidatorFn = (topic: string, message: InMessage) => Promise<void>;

/**
 * Map of TopicValidatorFn by topic string. What js-libp2p-gossipsub requires
 */
export type TopicValidatorFnMap = Map<string, TopicValidatorFn>;

/**
 * Overridden `InMessage`
 *
 * Possibly includes cached msgId, uncompressed message data, deserialized data
 */
export interface IGossipMessage extends InMessage {
  /**
   * Cached message id
   */
  msgId?: Uint8Array;
  /**
   * Cached uncompressed data
   */
  uncompressed?: Uint8Array;
  /**
   * deserialized data
   */
  gossipObject?: GossipObject;
  /**
   * gossip topic
   */
  gossipTopic?: GossipTopic;
}
