/**
 * @module network/gossip
 */

import {GossipEvent} from "./constants";
import {
  AggregateAndProof,
  Attestation,
  AttesterSlashing,
  ProposerSlashing,
  SignedBeaconBlock,
  SignedVoluntaryExit
} from "@chainsafe/lodestar-types";
import StrictEventEmitter from "strict-event-emitter-types";
import {EventEmitter} from "events";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import LibP2p from "libp2p";
import {ILogger} from  "@chainsafe/lodestar-utils/lib/logger";
import {IService} from "../../node";
import {IGossipMessage} from "libp2p-gossipsub";
import {IBeaconChain} from "../../chain";
import {ForkDigest} from "@chainsafe/lodestar-types";

export interface IGossipEvents {
  [GossipEvent.BLOCK]: (signedBlock: SignedBeaconBlock) => void;
  [GossipEvent.ATTESTATION_SUBNET]: (attestationSubnet: {attestation: Attestation; subnet: number}) => void;
  [GossipEvent.ATTESTATION]: (attestation: Attestation) => void;
  [GossipEvent.AGGREGATE_AND_PROOF]: (attestation: AggregateAndProof) => void;
  [GossipEvent.VOLUNTARY_EXIT]: (voluntaryExit: SignedVoluntaryExit) => void;
  [GossipEvent.PROPOSER_SLASHING]: (proposerSlashing: ProposerSlashing) => void;
  [GossipEvent.ATTESTER_SLASHING]: (attesterSlashing: AttesterSlashing) => void;
  ["gossipsub:heartbeat"]: () => void;
}
export type GossipEventEmitter = StrictEventEmitter<EventEmitter, IGossipEvents>;

export interface IGossipModules {
  config: IBeaconConfig;
  libp2p: LibP2p;
  logger: ILogger;
  validator: IGossipMessageValidator;
  chain: IBeaconChain;
}

export interface IGossipSub extends EventEmitter {
  publish(topic: string, data: Buffer): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  subscribe(topic: string): void;
  unsubscribe(topic: string): void;
}

export interface IGossip extends IService, GossipEventEmitter {
  publishBlock(signedBlock: SignedBeaconBlock): Promise<void>;
  publishCommiteeAttestation(attestation: Attestation): Promise<void>;
  publishAggregatedAttestation(aggregateAndProof: AggregateAndProof): Promise<void>;
  publishVoluntaryExit(voluntaryExit: SignedVoluntaryExit): Promise<void>;
  publishAttesterSlashing(attesterSlashing: AttesterSlashing): Promise<void>;
  publishProposerSlashing(proposerSlashing: ProposerSlashing): Promise<void>;
  subscribeToBlock(forkDigest: ForkDigest, callback: (signedBlock: SignedBeaconBlock) => void): void;
  subscribeToAggregateAndProof(forkDigest: ForkDigest, callback: (aggregate: AggregateAndProof) => void): void;
  subscribeToAttestation(forkDigest: ForkDigest, callback: (attestation: Attestation) => void): void;
  subscribeToVoluntaryExit(
    forkDigest: ForkDigest, callback: (voluntaryExit: SignedVoluntaryExit) => void): void;
  subscribeToProposerSlashing(forkDigest: ForkDigest, callback: (slashing: ProposerSlashing) => void): void;
  subscribeToAttesterSlashing(forkDigest: ForkDigest, callback: (slashing: AttesterSlashing) => void): void;
  subscribeToAttestationSubnet(
    forkDigest: ForkDigest,
    subnet: number|string,
    callback?: (attestation:  {attestation: Attestation; subnet: number}) => void
  ): void;
  unsubscribeFromAttestationSubnet(
    forkDigest: ForkDigest,
    subnet: number|string,
    callback?: (attestation:  {attestation: Attestation; subnet: number}) => void
  ): void;
  unsubscribe(
    forkDigest: ForkDigest, event: keyof IGossipEvents, listener: unknown, params?: Map<string, string>): void;
}

export interface IGossipMessageValidator {
  isValidIncomingBlock(signedBlock: SignedBeaconBlock): Promise<boolean>;
  isValidIncomingCommitteeAttestation(attestation: Attestation, subnet: number): Promise<boolean>;
  isValidIncomingAggregateAndProof(aggregateAndProof: AggregateAndProof): Promise<boolean>;
  isValidIncomingUnaggregatedAttestation(attestation: Attestation): Promise<boolean>;
  isValidIncomingVoluntaryExit(voluntaryExit: SignedVoluntaryExit): Promise<boolean>;
  isValidIncomingProposerSlashing(proposerSlashing: ProposerSlashing): Promise<boolean>;
  isValidIncomingAttesterSlashing(attesterSlashing: AttesterSlashing): Promise<boolean>;
}

export type GossipObject = SignedBeaconBlock | Attestation | AggregateAndProof | 
SignedVoluntaryExit | ProposerSlashing | AttesterSlashing;

export type GossipMessageValidatorFn = (message: GossipObject, subnet?: number) => Promise<boolean>;

export interface ILodestarGossipMessage extends IGossipMessage{
  messageId: string;
}