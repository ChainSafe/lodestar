/**
 * @module network/gossip
 */

import {GossipEvent, ExtendedValidatorResult} from "./constants";
import {phase0} from "@chainsafe/lodestar-types";
import StrictEventEmitter from "strict-event-emitter-types";
import {EventEmitter} from "events";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import LibP2p from "libp2p";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {IService} from "../../node";
import {InMessage} from "libp2p-interfaces/src/pubsub";
import {IBeaconChain} from "../../chain";
import {ForkDigest} from "@chainsafe/lodestar-types";
import {NetworkEvent} from "../interface";

export interface IGossipEvents {
  // attestation subnet event is dynamic following this signature
  // [attSubnetTopic: string]: (attestationSubnet: {attestation: Attestation; subnet: number}) => void;
  [GossipEvent.BLOCK]: (signedBlock: phase0.SignedBeaconBlock) => void;
  [GossipEvent.AGGREGATE_AND_PROOF]: (attestation: phase0.SignedAggregateAndProof) => void;
  [GossipEvent.VOLUNTARY_EXIT]: (voluntaryExit: phase0.SignedVoluntaryExit) => void;
  [GossipEvent.PROPOSER_SLASHING]: (proposerSlashing: phase0.ProposerSlashing) => void;
  [GossipEvent.ATTESTER_SLASHING]: (attesterSlashing: phase0.AttesterSlashing) => void;
  [NetworkEvent.gossipHeartbeat]: () => void;
  [NetworkEvent.gossipStart]: () => void;
  [NetworkEvent.gossipStop]: () => void;
}
export type GossipEventEmitter = StrictEventEmitter<EventEmitter, IGossipEvents>;

export interface IGossipModules {
  config: IBeaconConfig;
  libp2p: LibP2p;
  logger: ILogger;
  validator: IGossipMessageValidator;
  chain: IBeaconChain;
  pubsub?: IGossipSub;
}

/**
 * Implementation of eth2 p2p gossipsub.
 * For the spec that this code is based on, see:
 * https://github.com/ethereum/eth2.0-specs/blob/dev/specs/phase0/p2p-interface.md#the-gossip-domain-gossipsub
 */
export interface IGossipSub extends EventEmitter {
  subscriptions: Set<string>;
  /** Publish a gossipsub topic */
  publish(topic: string, data: Buffer): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Subscribe to a gossipub topic */
  subscribe(topics: string[] | string): void;
  /** Unsubscribe from a gossipub topic */
  unsubscribe(topics: string[] | string): void;
  registerLibp2pTopicValidators(forkDigest: ForkDigest): void;
  getTopicPeerIds(topic: string): Set<string> | undefined;
}

export interface IGossip extends IService, GossipEventEmitter {
  publishBlock(signedBlock: phase0.SignedBeaconBlock): Promise<void>;
  publishCommiteeAttestation(attestation: phase0.Attestation): Promise<void>;
  publishAggregatedAttestation(signedAggregateAndProof: phase0.SignedAggregateAndProof): Promise<void>;
  publishVoluntaryExit(voluntaryExit: phase0.SignedVoluntaryExit): Promise<void>;
  publishAttesterSlashing(attesterSlashing: phase0.AttesterSlashing): Promise<void>;
  publishProposerSlashing(proposerSlashing: phase0.ProposerSlashing): Promise<void>;
  subscribeToBlock(forkDigest: ForkDigest, callback: (signedBlock: phase0.SignedBeaconBlock) => void): void;
  subscribeToAggregateAndProof(
    forkDigest: ForkDigest,
    callback: (aggregate: phase0.SignedAggregateAndProof) => void
  ): void;
  subscribeToVoluntaryExit(forkDigest: ForkDigest, callback: (voluntaryExit: phase0.SignedVoluntaryExit) => void): void;
  subscribeToProposerSlashing(forkDigest: ForkDigest, callback: (slashing: phase0.ProposerSlashing) => void): void;
  subscribeToAttesterSlashing(forkDigest: ForkDigest, callback: (slashing: phase0.AttesterSlashing) => void): void;
  subscribeToAttestationSubnet(
    forkDigest: ForkDigest,
    subnet: number | string,
    callback?: (attestation: {attestation: phase0.Attestation; subnet: number}) => void
  ): void;
  unsubscribeFromAttestationSubnet(
    forkDigest: ForkDigest,
    subnet: number | string,
    callback?: (attestation: {attestation: phase0.Attestation; subnet: number}) => void
  ): void;
  unsubscribe(
    forkDigest: ForkDigest,
    event: keyof IGossipEvents,
    listener: unknown,
    params?: Map<string, string>
  ): void;
}

/**
 * Contains various methods for validation of incoming gossip topic data.
 * The conditions for valid gossip topics and how they are handled are specified here:
 * https://github.com/ethereum/eth2.0-specs/blob/dev/specs/phase0/p2p-interface.md#global-topics
 */
export interface IGossipMessageValidator {
  isValidIncomingBlock(signedBlock: phase0.SignedBeaconBlock): Promise<ExtendedValidatorResult>;
  isValidIncomingCommitteeAttestation(
    attestation: phase0.Attestation,
    subnet: number
  ): Promise<ExtendedValidatorResult>;
  isValidIncomingAggregateAndProof(
    signedAggregateAndProof: phase0.SignedAggregateAndProof
  ): Promise<ExtendedValidatorResult>;
  isValidIncomingVoluntaryExit(voluntaryExit: phase0.SignedVoluntaryExit): Promise<ExtendedValidatorResult>;
  isValidIncomingProposerSlashing(proposerSlashing: phase0.ProposerSlashing): Promise<ExtendedValidatorResult>;
  isValidIncomingAttesterSlashing(attesterSlashing: phase0.AttesterSlashing): Promise<ExtendedValidatorResult>;
}

export type GossipObject =
  | phase0.SignedBeaconBlock
  | phase0.Attestation
  | phase0.SignedAggregateAndProof
  | phase0.SignedVoluntaryExit
  | phase0.ProposerSlashing
  | phase0.AttesterSlashing;

export type GossipMessageValidatorFn = (message: GossipObject, subnet?: number) => Promise<ExtendedValidatorResult>;

/**
 * Overridden `InMessage`
 *
 * Since computing a msgId requires uncompressing the data, we cache the msgId
 */
export interface ILodestarGossipMessage extends InMessage {
  /**
   * Cached message id
   */
  msgId?: Uint8Array;
}
