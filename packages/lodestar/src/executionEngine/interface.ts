import {bellatrix, Root, RootHex, ValidatorIndex, Epoch, ExecutionAddress} from "@chainsafe/lodestar-types";
import {MapDef} from "../util/map";

import {DATA, QUANTITY} from "../eth1/provider/utils";
// An execution engine can produce a payload id anywhere the the uint64 range
// Since we do no processing with this id, we have no need to deserialize it
export type PayloadId = string;

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
  /** invalid terminal block */
  INVALID_TERMINAL_BLOCK = "INVALID_TERMINAL_BLOCK",
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
      status:
        | ExecutePayloadStatus.INVALID_BLOCK_HASH
        | ExecutePayloadStatus.INVALID_TERMINAL_BLOCK
        | ExecutePayloadStatus.ELERROR
        | ExecutePayloadStatus.UNAVAILABLE;
      latestValidHash: null;
      validationError: string;
    };

export type ForkChoiceUpdateStatus =
  | ExecutePayloadStatus.VALID
  | ExecutePayloadStatus.INVALID
  | ExecutePayloadStatus.SYNCING
  | ExecutePayloadStatus.INVALID_TERMINAL_BLOCK;

export type PayloadAttributes = {
  timestamp: number;
  prevRandao: Uint8Array;
  suggestedFeeRecipient: Uint8Array;
};

export type ApiPayloadAttributes = {
  /** QUANTITY, 64 Bits - value for the timestamp field of the new payload */
  timestamp: QUANTITY;
  /** DATA, 32 Bytes - value for the prevRandao field of the new payload */
  prevRandao: DATA;
  /** DATA, 20 Bytes - suggested value for the coinbase field of the new payload */
  suggestedFeeRecipient: DATA;
};

export type ProposerPreparationData = {
  validatorIndex: ValidatorIndex;
  feeRecipient: ExecutionAddress;
};
/**
 * Execution engine represents an abstract protocol to interact with execution clients. Potential transports include:
 * - JSON RPC over network
 * - IPC
 * - Integrated code into the same binary
 */
export interface IExecutionEngine {
  proposers: MapDef<ValidatorIndex, {epoch: Epoch; feeRecipient: ExecutionAddress}>;
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

  updateProposerPreparation(currentEpoch: Epoch, proposers: ProposerPreparationData[]): Promise<void>;
}
