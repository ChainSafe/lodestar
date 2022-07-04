import {bellatrix, Root, RootHex} from "@lodestar/types";
import {PayloadIdCache, PayloadId, ApiPayloadAttributes} from "./payloadIdCache.js";

export {PayloadIdCache, PayloadId, ApiPayloadAttributes};
export enum ExecutePayloadStatus {
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

export type ExecutePayloadResponse =
  | {status: ExecutePayloadStatus.SYNCING | ExecutePayloadStatus.ACCEPTED; latestValidHash: null; validationError: null}
  | {status: ExecutePayloadStatus.VALID; latestValidHash: RootHex; validationError: null}
  | {status: ExecutePayloadStatus.INVALID; latestValidHash: RootHex; validationError: string | null}
  | {
      status: ExecutePayloadStatus.INVALID_BLOCK_HASH | ExecutePayloadStatus.ELERROR | ExecutePayloadStatus.UNAVAILABLE;
      latestValidHash: null;
      validationError: string;
    };

export type ForkChoiceUpdateStatus =
  | ExecutePayloadStatus.VALID
  | ExecutePayloadStatus.INVALID
  | ExecutePayloadStatus.SYNCING;

export type PayloadAttributes = {
  timestamp: number;
  prevRandao: Uint8Array;
  // DATA is anyway a hex string, so we can just track it as a hex string to
  // avoid any conversions
  suggestedFeeRecipient: string;
};

/**
 * Execution engine represents an abstract protocol to interact with execution clients. Potential transports include:
 * - JSON RPC over network
 * - IPC
 * - Integrated code into the same binary
 */
export interface IExecutionEngine {
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
  notifyNewPayload(executionPayload: bellatrix.ExecutionPayload): Promise<ExecutePayloadResponse>;

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
    headBlockHash: Root | RootHex,
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
  getPayload(payloadId: PayloadId): Promise<bellatrix.ExecutionPayload>;
}
