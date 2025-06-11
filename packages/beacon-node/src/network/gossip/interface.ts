import {PeerIdStr} from "@chainsafe/libp2p-gossipsub/types";
import {Message, TopicValidatorResult} from "@libp2p/interface";
import {BeaconConfig} from "@lodestar/config";
import {
  AttesterSlashing,
  LightClientFinalityUpdate,
  LightClientOptimisticUpdate,
  SignedAggregateAndProof,
  SignedBeaconBlock,
  SingleAttestation,
  Slot,
  SubnetID,
  altair,
  capella,
  deneb,
  fulu,
  phase0,
} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {Libp2p} from "libp2p";
import {AttestationError} from "../../chain/errors/attestationError.js";
import {DataColumnSidecarGossipError} from "../../chain/errors/dataColumnSidecarError.js";
import {IBeaconChain} from "../../chain/index.js";
import {JobItemQueue} from "../../util/queue/index.js";
import {SubscribeBoundary} from "../core/types.js";

export enum GossipType {
  beacon_block = "beacon_block",
  blob_sidecar = "blob_sidecar",
  data_column_sidecar = "data_column_sidecar",
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

export type BatchGossipType = GossipType.beacon_attestation | GossipType.data_column_sidecar;
export type SequentialGossipType = Exclude<GossipType, BatchGossipType>;

export enum GossipEncoding {
  ssz_snappy = "ssz_snappy",
}

/**
 * Note: `IGossipTopic`s are all relative to the local `genesisValidatorsRoot`
 */
export interface IGossipTopic {
  type: GossipType;
  boundary: SubscribeBoundary;
  encoding?: GossipEncoding;
}

export type GossipTopicTypeMap = {
  [GossipType.beacon_block]: {type: GossipType.beacon_block};
  [GossipType.blob_sidecar]: {type: GossipType.blob_sidecar; subnet: SubnetID};
  [GossipType.data_column_sidecar]: {type: GossipType.data_column_sidecar; subnet: SubnetID};
  [GossipType.beacon_aggregate_and_proof]: {type: GossipType.beacon_aggregate_and_proof};
  [GossipType.beacon_attestation]: {type: GossipType.beacon_attestation; subnet: SubnetID};
  [GossipType.voluntary_exit]: {type: GossipType.voluntary_exit};
  [GossipType.proposer_slashing]: {type: GossipType.proposer_slashing};
  [GossipType.attester_slashing]: {type: GossipType.attester_slashing};
  [GossipType.sync_committee_contribution_and_proof]: {
    type: GossipType.sync_committee_contribution_and_proof;
  };
  [GossipType.sync_committee]: {type: GossipType.sync_committee; subnet: SubnetID};
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

export type SSZTypeOfGossipTopic<T extends GossipTopic> = T extends {type: infer K extends GossipType}
  ? GossipTypeMap[K]
  : never;

export type GossipTypeMap = {
  [GossipType.beacon_block]: SignedBeaconBlock;
  [GossipType.blob_sidecar]: deneb.BlobSidecar;
  [GossipType.beacon_aggregate_and_proof]: SignedAggregateAndProof;
  [GossipType.beacon_attestation]: SingleAttestation;
  [GossipType.data_column_sidecar]: fulu.DataColumnSidecar;
  [GossipType.voluntary_exit]: phase0.SignedVoluntaryExit;
  [GossipType.proposer_slashing]: phase0.ProposerSlashing;
  [GossipType.attester_slashing]: AttesterSlashing;
  [GossipType.sync_committee_contribution_and_proof]: altair.SignedContributionAndProof;
  [GossipType.sync_committee]: altair.SyncCommitteeMessage;
  [GossipType.light_client_finality_update]: LightClientFinalityUpdate;
  [GossipType.light_client_optimistic_update]: LightClientOptimisticUpdate;
  [GossipType.bls_to_execution_change]: capella.SignedBLSToExecutionChange;
};

export type GossipFnByType = {
  [GossipType.beacon_block]: (signedBlock: SignedBeaconBlock) => Promise<void> | void;
  [GossipType.blob_sidecar]: (blobSidecar: deneb.BlobSidecar) => Promise<void> | void;
  [GossipType.beacon_aggregate_and_proof]: (aggregateAndProof: SignedAggregateAndProof) => Promise<void> | void;
  [GossipType.beacon_attestation]: (attestation: SingleAttestation) => Promise<void> | void;
  [GossipType.data_column_sidecar]: (dataColumnSidecar: fulu.DataColumnSidecar) => Promise<void> | void;
  [GossipType.voluntary_exit]: (voluntaryExit: phase0.SignedVoluntaryExit) => Promise<void> | void;
  [GossipType.proposer_slashing]: (proposerSlashing: phase0.ProposerSlashing) => Promise<void> | void;
  [GossipType.attester_slashing]: (attesterSlashing: AttesterSlashing) => Promise<void> | void;
  [GossipType.sync_committee_contribution_and_proof]: (
    signedContributionAndProof: altair.SignedContributionAndProof
  ) => Promise<void> | void;
  [GossipType.sync_committee]: (syncCommittee: altair.SyncCommitteeMessage) => Promise<void> | void;
  [GossipType.light_client_finality_update]: (
    lightClientFinalityUpdate: LightClientFinalityUpdate
  ) => Promise<void> | void;
  [GossipType.light_client_optimistic_update]: (
    lightClientOptimisticUpdate: LightClientOptimisticUpdate
  ) => Promise<void> | void;
  [GossipType.bls_to_execution_change]: (
    blsToExecutionChange: capella.SignedBLSToExecutionChange
  ) => Promise<void> | void;
};

export type GossipFn = GossipFnByType[keyof GossipFnByType];

export type GossipModules = {
  config: BeaconConfig;
  libp2p: Libp2p;
  logger: Logger;
  chain: IBeaconChain;
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
export type GossipMessageInfo<T extends GossipType> = {
  topic: GossipTopicMap[T];
  msg: Message;
  propagationSource: PeerIdStr;
  seenTimestampSec: number;
  msgSlot: Slot | null;
  indexed?: string;
};

export type SequentialGossipMessageInfo<T extends SequentialGossipType = SequentialGossipType> = GossipMessageInfo<T>;

export type BatchGossipMessageInfo<T extends BatchGossipType = BatchGossipType> = GossipMessageInfo<T>;

export type GossipValidatorFn = (messageInfo: SequentialGossipMessageInfo) => Promise<TopicValidatorResult>;

export type GossipValidatorBatchFn = (messageInfos: BatchGossipMessageInfo[]) => Promise<TopicValidatorResult[]>;

export type ValidatorFnsByType = {[K in GossipType]: GossipValidatorFn};

export type GossipJobQueues = {
  [K in GossipType]: JobItemQueue<Parameters<GossipValidatorFn>, ResolvedType<GossipValidatorFn>>;
};

export type GossipData = {
  serializedData: Uint8Array;
  msgSlot?: Slot | null;
  indexed?: string;
};

export type GossipHandlerFn = (gossipHandlerParam: GossipHandlerParamGeneric<SequentialGossipType>) => Promise<void>;

export type GossipHandlerParamGeneric<T extends GossipType> = {
  gossipData: GossipData;
  topic: GossipTopicMap[T];
  peerIdStr: string;
  seenTimestampSec: number;
};

export type BatchGossipHandlerParamGeneric<T extends BatchGossipType> = GossipHandlerParamGeneric<T>;

export type GossipHandlers = SequentialGossipHandlers & BatchGossipHandlers;

export type SequentialGossipHandler<K extends SequentialGossipType> = (
  gossipHandlerParam: GossipHandlerParamGeneric<K>
) => Promise<void>;

export type SequentialGossipHandlers = {
  [K in SequentialGossipType]: SequentialGossipHandler<K>;
};

export type BatchGossipHandlers = {
  [K in BatchGossipType]: BatchGossipHandler<K>;
};

export type BatchGossipActionErrorGeneric = {
  [GossipType.beacon_attestation]: AttestationError;
  [GossipType.data_column_sidecar]: DataColumnSidecarGossipError;
};

export type BatchGossipHandler<K extends BatchGossipType> = (
  gossipHandlerParams: BatchGossipHandlerParamGeneric<K>[]
) => Promise<(null | BatchGossipActionErrorGeneric[K])[]>;

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
export type ResolvedType<F extends (...args: any) => Promise<any>> = F extends (...args: any) => Promise<infer T>
  ? T
  : never;
