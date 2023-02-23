import {EventEmitter} from "events";
import {Libp2p} from "libp2p";
import {Message, TopicValidatorResult} from "@libp2p/interface-pubsub";
import StrictEventEmitter from "strict-event-emitter-types";
import {PeerIdStr} from "@chainsafe/libp2p-gossipsub/types";
import {ForkName} from "@lodestar/params";
import {allForks, altair, capella, deneb, phase0} from "@lodestar/types";
import {BeaconConfig} from "@lodestar/config";
import {Logger} from "@lodestar/utils";
import {IBeaconChain} from "../../chain/index.js";
import {NetworkEvent} from "../events.js";
import {JobItemQueue} from "../../util/queue/index.js";

export enum GossipType {
  beacon_block = "beacon_block",
  beacon_block_and_blobs_sidecar = "beacon_block_and_blobs_sidecar",
  beacon_aggregate_and_proof = "beacon_aggregate_and_proof",
  beacon_attestation = "beacon_attestation",
  voluntary_exit = "voluntary_exit",
  proposer_slashing = "proposer_slashing",
  attester_slashing = "attester_slashing",
  sync_committee_contribution_and_proof = "sync_committee_contribution_and_proof",
  sync_committee = "sync_committee",
  light_client_finality_update = "light_client_finality_update",
  light_client_optimistic_update = "light_client_optimistic_update",
  bls_to_execution_change = "bls_to_execution_change",
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
  [GossipType.beacon_block_and_blobs_sidecar]: {type: GossipType.beacon_block_and_blobs_sidecar};
  [GossipType.beacon_aggregate_and_proof]: {type: GossipType.beacon_aggregate_and_proof};
  [GossipType.beacon_attestation]: {type: GossipType.beacon_attestation; subnet: number};
  [GossipType.voluntary_exit]: {type: GossipType.voluntary_exit};
  [GossipType.proposer_slashing]: {type: GossipType.proposer_slashing};
  [GossipType.attester_slashing]: {type: GossipType.attester_slashing};
  [GossipType.sync_committee_contribution_and_proof]: {
    type: GossipType.sync_committee_contribution_and_proof;
  };
  [GossipType.sync_committee]: {type: GossipType.sync_committee; subnet: number};
  [GossipType.light_client_finality_update]: {type: GossipType.light_client_finality_update};
  [GossipType.light_client_optimistic_update]: {type: GossipType.light_client_optimistic_update};
  [GossipType.bls_to_execution_change]: {type: GossipType.bls_to_execution_change};
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
  [GossipType.beacon_block_and_blobs_sidecar]: deneb.SignedBeaconBlockAndBlobsSidecar;
  [GossipType.beacon_aggregate_and_proof]: phase0.SignedAggregateAndProof;
  [GossipType.beacon_attestation]: phase0.Attestation;
  [GossipType.voluntary_exit]: phase0.SignedVoluntaryExit;
  [GossipType.proposer_slashing]: phase0.ProposerSlashing;
  [GossipType.attester_slashing]: phase0.AttesterSlashing;
  [GossipType.sync_committee_contribution_and_proof]: altair.SignedContributionAndProof;
  [GossipType.sync_committee]: altair.SyncCommitteeMessage;
  [GossipType.light_client_finality_update]: allForks.LightClientFinalityUpdate;
  [GossipType.light_client_optimistic_update]: allForks.LightClientOptimisticUpdate;
  [GossipType.bls_to_execution_change]: capella.SignedBLSToExecutionChange;
};

export type GossipFnByType = {
  [GossipType.beacon_block]: (signedBlock: allForks.SignedBeaconBlock) => Promise<void> | void;
  [GossipType.beacon_block_and_blobs_sidecar]: (
    signedBeaconBlockAndBlobsSidecar: deneb.SignedBeaconBlockAndBlobsSidecar
  ) => Promise<void> | void;
  [GossipType.beacon_aggregate_and_proof]: (aggregateAndProof: phase0.SignedAggregateAndProof) => Promise<void> | void;
  [GossipType.beacon_attestation]: (attestation: phase0.Attestation) => Promise<void> | void;
  [GossipType.voluntary_exit]: (voluntaryExit: phase0.SignedVoluntaryExit) => Promise<void> | void;
  [GossipType.proposer_slashing]: (proposerSlashing: phase0.ProposerSlashing) => Promise<void> | void;
  [GossipType.attester_slashing]: (attesterSlashing: phase0.AttesterSlashing) => Promise<void> | void;
  [GossipType.sync_committee_contribution_and_proof]: (
    signedContributionAndProof: altair.SignedContributionAndProof
  ) => Promise<void> | void;
  [GossipType.sync_committee]: (syncCommittee: altair.SyncCommitteeMessage) => Promise<void> | void;
  [GossipType.light_client_finality_update]: (
    lightClientFinalityUpdate: allForks.LightClientFinalityUpdate
  ) => Promise<void> | void;
  [GossipType.light_client_optimistic_update]: (
    lightClientOptimisticUpdate: allForks.LightClientOptimisticUpdate
  ) => Promise<void> | void;
  [GossipType.bls_to_execution_change]: (
    blsToExecutionChange: capella.SignedBLSToExecutionChange
  ) => Promise<void> | void;
};

export type GossipFn = GossipFnByType[keyof GossipFnByType];

export type GossipEvents = {
  [topicStr: string]: GossipFn;
  [NetworkEvent.gossipHeartbeat]: () => void;
  [NetworkEvent.gossipStart]: () => void;
  [NetworkEvent.gossipStop]: () => void;
};
export type GossipEventEmitter = StrictEventEmitter<EventEmitter, GossipEvents>;

export type GossipModules = {
  config: BeaconConfig;
  libp2p: Libp2p;
  logger: Logger;
  chain: IBeaconChain;
};

export type GossipBeaconNode = {
  publishBeaconBlock(signedBlock: allForks.SignedBeaconBlock): Promise<void>;
  publishSignedBeaconBlockAndBlobsSidecar(item: deneb.SignedBeaconBlockAndBlobsSidecar): Promise<void>;
  publishBeaconAggregateAndProof(aggregateAndProof: phase0.SignedAggregateAndProof): Promise<number>;
  publishBeaconAttestation(attestation: phase0.Attestation, subnet: number): Promise<number>;
  publishVoluntaryExit(voluntaryExit: phase0.SignedVoluntaryExit): Promise<void>;
  publishBlsToExecutionChange(blsToExecutionChange: capella.SignedBLSToExecutionChange): Promise<void>;
  publishProposerSlashing(proposerSlashing: phase0.ProposerSlashing): Promise<void>;
  publishAttesterSlashing(attesterSlashing: phase0.AttesterSlashing): Promise<void>;
  publishSyncCommitteeSignature(signature: altair.SyncCommitteeMessage, subnet: number): Promise<void>;
  publishContributionAndProof(contributionAndProof: altair.SignedContributionAndProof): Promise<void>;
  publishLightClientFinalityUpdate(lightClientFinalityUpdate: allForks.LightClientFinalityUpdate): Promise<void>;
  publishLightClientOptimisticUpdate(lightClientOptimisitcUpdate: allForks.LightClientOptimisticUpdate): Promise<void>;
};

/**
 * Contains various methods for validation of incoming gossip topic data.
 * The conditions for valid gossip topics and how they are handled are specified here:
 * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/p2p-interface.md#global-topics
 */

/**
 * Top-level type for gossip validation functions
 *
 * js-libp2p-gossipsub expects validation functions that look like this
 */
export type GossipValidatorFn = (
  topic: GossipTopic,
  msg: Message,
  propagationSource: PeerIdStr,
  seenTimestampSec: number
) => Promise<TopicValidatorResult>;

export type ValidatorFnsByType = {[K in GossipType]: GossipValidatorFn};

export type GossipJobQueues = {
  [K in GossipType]: JobItemQueue<Parameters<GossipValidatorFn>, ResolvedType<GossipValidatorFn>>;
};

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ResolvedType<F extends (...args: any) => Promise<any>> = F extends (...args: any) => Promise<infer T>
  ? T
  : never;
