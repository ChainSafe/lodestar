import {Libp2p} from "libp2p";
import {Message, TopicValidatorResult} from "@libp2p/interface";
import {PeerIdStr} from "@chainsafe/libp2p-gossipsub/types";
import {ForkName} from "@lodestar/params";
import {
  altair,
  capella,
  deneb,
  LightClientFinalityUpdate,
  LightClientOptimisticUpdate,
  phase0,
  SignedBeaconBlock,
  Slot,
  Attestation,
  SignedAggregateAndProof,
} from "@lodestar/types";
import {BeaconConfig} from "@lodestar/config";
import {Logger} from "@lodestar/utils";
import {IBeaconChain} from "../../chain/index.js";
import {JobItemQueue} from "../../util/queue/index.js";
import {AttestationError, AttestationErrorType} from "../../chain/errors/attestationError.js";
import {GossipActionError} from "../../chain/errors/gossipValidation.js";

export enum GossipType {
  beacon_block = "beacon_block",
  blob_sidecar = "blob_sidecar",
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

export type SequentialGossipType = Exclude<GossipType, GossipType.beacon_attestation>;
export type BatchGossipType = GossipType.beacon_attestation;

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
  [GossipType.blob_sidecar]: {type: GossipType.blob_sidecar; index: number};
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

export type SSZTypeOfGossipTopic<T extends GossipTopic> = T extends {type: infer K extends GossipType}
  ? GossipTypeMap[K]
  : never;

export type GossipTypeMap = {
  [GossipType.beacon_block]: SignedBeaconBlock;
  [GossipType.blob_sidecar]: deneb.BlobSidecar;
  [GossipType.beacon_aggregate_and_proof]: SignedAggregateAndProof;
  [GossipType.beacon_attestation]: Attestation;
  [GossipType.voluntary_exit]: phase0.SignedVoluntaryExit;
  [GossipType.proposer_slashing]: phase0.ProposerSlashing;
  [GossipType.attester_slashing]: phase0.AttesterSlashing;
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
  [GossipType.beacon_attestation]: (attestation: Attestation) => Promise<void> | void;
  [GossipType.voluntary_exit]: (voluntaryExit: phase0.SignedVoluntaryExit) => Promise<void> | void;
  [GossipType.proposer_slashing]: (proposerSlashing: phase0.ProposerSlashing) => Promise<void> | void;
  [GossipType.attester_slashing]: (attesterSlashing: phase0.AttesterSlashing) => Promise<void> | void;
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
export type GossipMessageInfo = {
  topic: GossipTopic;
  msg: Message;
  propagationSource: PeerIdStr;
  seenTimestampSec: number;
  msgSlot: Slot | null;
  indexed?: string;
};

export type GossipValidatorFn = (messageInfo: GossipMessageInfo) => Promise<TopicValidatorResult>;

export type GossipValidatorBatchFn = (messageInfos: GossipMessageInfo[]) => Promise<TopicValidatorResult[]>;

export type ValidatorFnsByType = {[K in GossipType]: GossipValidatorFn};

export type GossipJobQueues = {
  [K in GossipType]: JobItemQueue<Parameters<GossipValidatorFn>, ResolvedType<GossipValidatorFn>>;
};

export type GossipData = {
  serializedData: Uint8Array;
  msgSlot?: Slot | null;
  indexed?: string;
};

export type GossipHandlerParam = {
  gossipData: GossipData;
  topic: GossipTopicMap[GossipType];
  peerIdStr: string;
  seenTimestampSec: number;
};

export type GossipHandlerFn = (gossipHandlerParam: GossipHandlerParam) => Promise<void>;

export type BatchGossipHandlerFn = (gossipHandlerParam: GossipHandlerParam[]) => Promise<(null | AttestationError)[]>;

export type GossipHandlerParamGeneric<T extends GossipType> = {
  gossipData: GossipData;
  topic: GossipTopicMap[T];
  peerIdStr: string;
  seenTimestampSec: number;
};

export type GossipHandlers = {
  [K in GossipType]: SequentialGossipHandler<K> | BatchGossipHandler<K>;
};

export type SequentialGossipHandler<K extends GossipType> = (
  gossipHandlerParam: GossipHandlerParamGeneric<K>
) => Promise<void>;

export type SequentialGossipHandlers = {
  [K in SequentialGossipType]: SequentialGossipHandler<K>;
};

export type BatchGossipHandlers = {
  [K in BatchGossipType]: BatchGossipHandler<K>;
};

export type BatchGossipHandler<K extends GossipType> = (
  gossipHandlerParams: GossipHandlerParamGeneric<K>[]
) => Promise<(null | GossipActionError<AttestationErrorType>)[]>;

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
export type ResolvedType<F extends (...args: any) => Promise<any>> = F extends (...args: any) => Promise<infer T>
  ? T
  : never;
