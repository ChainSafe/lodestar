/**
 * @module network/gossip
 */

import {GossipEvent} from "./constants";
import {
  AggregateAndProof,
  Attestation,
  AttesterSlashing,
  BeaconBlock,
  ProposerSlashing,
  VoluntaryExit
} from "@chainsafe/eth2.0-types";
import StrictEventEmitter from "strict-event-emitter-types";
import {EventEmitter} from "events";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import LibP2p from "libp2p";
import {ILogger} from "../../logger";
import {IService} from "../../node";

export interface IGossipEvents {
  [GossipEvent.BLOCK]: (block: BeaconBlock) => void;
  [GossipEvent.ATTESTATION]: (attestation: Attestation) => void;
  [GossipEvent.AGGREGATE_AND_PROOF]: (attestation: AggregateAndProof) => void;
  [GossipEvent.VOLUNTARY_EXIT]: (voluntaryExit: VoluntaryExit) => void;
  [GossipEvent.PROPOSER_SLASHING]: (proposerSlashing: ProposerSlashing) => void;
  [GossipEvent.ATTESTER_SLASHING]: (attesterSlashing: AttesterSlashing) => void;
  ["gossipsub:heartbeat"]: void;
}
export type GossipEventEmitter = StrictEventEmitter<EventEmitter, IGossipEvents>;

export interface IGossipModules {
  config: IBeaconConfig;
  libp2p: LibP2p;
  logger: ILogger;
}

export interface IGossip extends GossipEventEmitter, IService {
  publishBlock(block: BeaconBlock): Promise<void>;
  publishCommiteeAttestation(attestation: Attestation): Promise<void>;
  publishAggregatedAttestation(aggregateAndProof: AggregateAndProof): Promise<void>;
  publishVoluntaryExit(voluntaryExit: VoluntaryExit): Promise<void>;
  publishAttesterSlashing(attesterSlashing: AttesterSlashing): Promise<void>;
  publishProposerSlashing(proposerSlashing: ProposerSlashing): Promise<void>;
}

export interface IGossipMessage {
  data: Buffer;
}