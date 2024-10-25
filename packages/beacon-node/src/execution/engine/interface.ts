import {ForkName} from "@lodestar/params";
import {KZGCommitment, Blob, KZGProof} from "@lodestar/types/deneb";
import {Root, RootHex, capella, Wei, ExecutionPayload, ExecutionRequests} from "@lodestar/types";

import {DATA} from "../../eth1/provider/utils.js";
import {PayloadIdCache, PayloadId, WithdrawalV1} from "./payloadIdCache.js";
import {ExecutionPayloadBody} from "./types.js";

export {PayloadIdCache, type PayloadId, type WithdrawalV1};

export enum ExecutionPayloadStatus {
  /** given payload is valid */
  VALID = "VALID",
  /** given payload is invalid */
  INVALID = "INVALID",
  /** sync process is in progress */
  SYNCING = "SYNCING",
  /**
   * blockHash is valid, but payload is not part of canonical chain and hasn't been fully
   * validated
   */
  ACCEPTED = "ACCEPTED",
  /** blockHash is invalid */
  INVALID_BLOCK_HASH = "INVALID_BLOCK_HASH",
  /** EL error */
  ELERROR = "ELERROR",
  /** EL unavailable */
  UNAVAILABLE = "UNAVAILABLE",
  /** EL replied with SYNCING or ACCEPTED when its not safe to import optimistic blocks */
  UNSAFE_OPTIMISTIC_STATUS = "UNSAFE_OPTIMISTIC_STATUS",
}

export enum ExecutionEngineState {
  ONLINE = "ONLINE",
  OFFLINE = "OFFLINE",
  SYNCING = "SYNCING",
  SYNCED = "SYNCED",
  AUTH_FAILED = "AUTH_FAILED",
}

/**
 * Client code as defined in https://github.com/ethereum/execution-apis/blob/v1.0.0-beta.4/src/engine/identification.md#clientcode
 * ClientCode.XX is dedicated to other clients which do not have their own code
 */
export enum ClientCode {
  BU = "BU", // besu
  EJ = "EJ", // ethereumJS
  EG = "EG", // erigon
  GE = "GE", // go-ethereum
  GR = "GR", // grandine
  LH = "LH", // lighthouse
  LS = "LS", // lodestar
  NM = "NM", // nethermind
  NB = "NB", // nimbus
  TK = "TK", // teku
  PM = "PM", // prysm
  RH = "RH", // reth
  XX = "XX", // unknown
}

// Represents request type in ExecutionRequests defined in EIP-7685
export enum RequestType {
  DEPOSIT_REQUEST_TYPE = 0, // 0x00
  WITHDRAWAL_REQUEST_TYPE = 1, // 0x01
  CONSOLIDATION_REQUEST_TYPE = 2, // 0x02
}

export type ExecutePayloadResponse =
  | {
      status: ExecutionPayloadStatus.SYNCING | ExecutionPayloadStatus.ACCEPTED;
      latestValidHash: null;
      validationError: null;
    }
  | {status: ExecutionPayloadStatus.VALID; latestValidHash: RootHex; validationError: null}
  | {status: ExecutionPayloadStatus.INVALID; latestValidHash: RootHex | null; validationError: string | null}
  | {
      status:
        | ExecutionPayloadStatus.INVALID_BLOCK_HASH
        | ExecutionPayloadStatus.ELERROR
        | ExecutionPayloadStatus.UNAVAILABLE;
      latestValidHash: null;
      validationError: string;
    };

export type ForkChoiceUpdateStatus =
  | ExecutionPayloadStatus.VALID
  | ExecutionPayloadStatus.INVALID
  | ExecutionPayloadStatus.SYNCING;

export type PayloadAttributes = {
  timestamp: number;
  prevRandao: Uint8Array;
  // DATA is anyway a hex string, so we can just track it as a hex string to
  // avoid any conversions
  suggestedFeeRecipient: string;
  withdrawals?: capella.Withdrawal[];
  parentBeaconBlockRoot?: Uint8Array;
};

export type BlobsBundle = {
  /**
   * Execution payload `blockHash` for the caller to sanity-check the consistency with the `engine_getPayload` call
   * https://github.com/protolambda/execution-apis/blob/bf44a8d08ab34b861ef97fa9ef5c5e7806194547/src/engine/blob-extension.md?plain=1#L49
   */
  commitments: KZGCommitment[];
  blobs: Blob[];
  proofs: KZGProof[];
};

export type ClientVersion = {
  code: ClientCode;
  name: string;
  version: string;
  commit: string;
};

export type VersionedHashes = Uint8Array[];

/**
 * Execution engine represents an abstract protocol to interact with execution clients. Potential transports include:
 * - JSON RPC over network
 * - IPC
 * - Integrated code into the same binary
 */
export interface IExecutionEngine {
  readonly state: ExecutionEngineState;

  readonly clientVersion?: ClientVersion | null;

  payloadIdCache: PayloadIdCache;
  /**
   * A state transition function which applies changes to the self.execution_state.
   * Returns ``True`` iff ``execution_payload`` is valid with respect to ``self.execution_state``.
   *
   * Required for block processing in the beacon state transition function.
   * https://github.com/ethereum/consensus-specs/blob/0eb0a934a3/specs/merge/beacon-chain.md#on_payload
   *
   * Should be called in advance before, after or in parallel to block processing
   */
  notifyNewPayload(
    fork: ForkName,
    executionPayload: ExecutionPayload,
    versionedHashes?: VersionedHashes,
    parentBeaconBlockRoot?: Root,
    executionRequests?: ExecutionRequests
  ): Promise<ExecutePayloadResponse>;

  /**
   * Signal fork choice updates
   * This function performs two actions atomically:
   * - Re-organizes the execution payload chain and corresponding state to make head_block_hash the head.
   * - Applies finality to the execution state: it irreversibly persists the chain of all execution payloads and
   *   corresponding state, up to and including finalized_block_hash.
   *
   * The call of the notify_forkchoice_updated function maps on the POS_FORKCHOICE_UPDATED event defined in the EIP-3675.
   * https://github.com/ethereum/consensus-specs/blob/dev/specs/merge/fork-choice.md#notify_forkchoice_updated
   *
   * Should be called in response to fork-choice head and finalized events
   */
  notifyForkchoiceUpdate(
    fork: ForkName,
    headBlockHash: RootHex,
    safeBlockHash: RootHex,
    finalizedBlockHash: RootHex,
    payloadAttributes?: PayloadAttributes
  ): Promise<PayloadId | null>;

  /**
   * Given the payload_id, get_payload returns the most recent version of the execution payload that has been built
   * since the corresponding call to prepare_payload method.
   *
   * Required for block producing
   * https://github.com/ethereum/consensus-specs/blob/dev/specs/merge/validator.md#get_payload
   */
  getPayload(
    fork: ForkName,
    payloadId: PayloadId
  ): Promise<{
    executionPayload: ExecutionPayload;
    executionPayloadValue: Wei;
    blobsBundle?: BlobsBundle;
    executionRequests?: ExecutionRequests;
    shouldOverrideBuilder?: boolean;
  }>;

  getPayloadBodiesByHash(fork: ForkName, blockHash: DATA[]): Promise<(ExecutionPayloadBody | null)[]>;

  getPayloadBodiesByRange(fork: ForkName, start: number, count: number): Promise<(ExecutionPayloadBody | null)[]>;
}
