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

export interface IBeaconBlockTopic extends IGossipTopic {
  type: GossipType.beacon_block;
}

export interface IBeaconAggregateAndProofTopic extends IGossipTopic {
  type: GossipType.beacon_aggregate_and_proof;
}

export interface IBeaconAttestationTopic extends IGossipTopic {
  type: GossipType.beacon_attestation;
  subnet: number;
}

export interface IVoluntaryExitTopic extends IGossipTopic {
  type: GossipType.voluntary_exit;
}

export interface IProposerSlashingTopic extends IGossipTopic {
  type: GossipType.proposer_slashing;
}

export interface IAttesterSlashingTopic extends IGossipTopic {
  type: GossipType.attester_slashing;
}

/**
 * Gossip topic split into a struct
 */
export type GossipTopic =
  | IBeaconBlockTopic
  | IBeaconAggregateAndProofTopic
  | IBeaconAttestationTopic
  | IVoluntaryExitTopic
  | IProposerSlashingTopic
  | IAttesterSlashingTopic;

export type GossipFn =
  | ((signedBlock: phase0.SignedBeaconBlock) => Promise<void> | void)
  | ((attestation: phase0.SignedAggregateAndProof) => Promise<void> | void)
  | ((attestation: phase0.Attestation) => Promise<void> | void)
  | ((voluntaryExit: phase0.SignedVoluntaryExit) => Promise<void> | void)
  | ((proposerSlashing: phase0.ProposerSlashing) => Promise<void> | void)
  | ((attesterSlashing: phase0.AttesterSlashing) => Promise<void> | void);

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
 * Intermediate type for gossip validation functions.
 *
 * Gossip validation functions defined with this signature are easier to unit test
 */
export type ObjectValidatorFn = (
  modules: IObjectValidatorModules,
  topic: GossipTopic,
  object: GossipObject
) => Promise<void>;

/**
 * Top-level type for gossip validation functions
 *
 * js-libp2p-gossipsub expects validation functions that look like this
 */
export type TopicValidatorFn = (topic: string, message: InMessage) => Promise<void>;

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
