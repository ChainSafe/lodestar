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
} from "@chainsafe/eth2.0-types";
import StrictEventEmitter from "strict-event-emitter-types";
import {EventEmitter} from "events";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import LibP2p from "libp2p";
import {ILogger} from  "@chainsafe/eth2.0-utils/lib/logger";
import {IService} from "../../node";

export interface IGossipEvents {
  [GossipEvent.BLOCK]: (signedBlock: SignedBeaconBlock) => void;
  [GossipEvent.ATTESTATION_SUBNET]: (attestationSubnet: {attestation: Attestation; subnet: number}) => void;
  [GossipEvent.ATTESTATION]: (attestation: Attestation) => void;
  [GossipEvent.AGGREGATE_AND_PROOF]: (attestation: AggregateAndProof) => void;
  [GossipEvent.VOLUNTARY_EXIT]: (voluntaryExit: SignedVoluntaryExit) => void;
  [GossipEvent.PROPOSER_SLASHING]: (proposerSlashing: ProposerSlashing) => void;
  [GossipEvent.ATTESTER_SLASHING]: (attesterSlashing: AttesterSlashing) => void;
  ["gossipsub:heartbeat"]: void;
}
export type GossipEventEmitter = StrictEventEmitter<EventEmitter, IGossipEvents>;

export interface IGossipModules {
  config: IBeaconConfig;
  libp2p: LibP2p;
  logger: ILogger;
  validator: IGossipMessageValidator;
}

export interface IGossipSub extends EventEmitter {
  publish(topic: string, data: Buffer): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  subscribe(topic: string): void;
  unsubscribe(topic: string): void;
}

export interface IGossip extends GossipEventEmitter, IService {
  publishBlock(signedBlock: SignedBeaconBlock): Promise<void>;
  publishCommiteeAttestation(attestation: Attestation): Promise<void>;
  publishAggregatedAttestation(aggregateAndProof: AggregateAndProof): Promise<void>;
  publishVoluntaryExit(voluntaryExit: SignedVoluntaryExit): Promise<void>;
  publishAttesterSlashing(attesterSlashing: AttesterSlashing): Promise<void>;
  publishProposerSlashing(proposerSlashing: ProposerSlashing): Promise<void>;
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

export interface IGossipMessage {
  data: Buffer;
}
