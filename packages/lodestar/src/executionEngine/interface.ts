import {Bytes32, merge, Root, ExecutionAddress, RootHex} from "@chainsafe/lodestar-types";

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
}

/**
 * Execution engine represents an abstract protocol to interact with execution clients. Potential transports include:
 * - JSON RPC over network
 * - IPC
 * - Integrated code into the same binary
 */
export interface IExecutionEngine {
  /**
   * A state transition function which applies changes to the self.execution_state.
   * Returns ``True`` iff ``execution_payload`` is valid with respect to ``self.execution_state``.
   *
   * Required for block processing in the beacon state transition function.
   * https://github.com/ethereum/consensus-specs/blob/0eb0a934a3/specs/merge/beacon-chain.md#on_payload
   *
   * Should be called in advance before, after or in parallel to block processing
   */
  executePayload(executionPayload: merge.ExecutionPayload): Promise<ExecutePayloadStatus>;

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
  notifyForkchoiceUpdate(headBlockHash: RootHex, finalizedBlockHash: RootHex): Promise<void>;

  /**
   * Given the set of execution payload attributes, prepare_payload initiates a process of building an execution
   * payload on top of the execution chain tip identified by parent_hash.
   *
   * Required for block producing
   * https://github.com/ethereum/consensus-specs/blob/dev/specs/merge/validator.md#prepare_payload
   *
   * Must be called close to the slot associated with the validator's block producing to get the blockHash and
   * random correct
   */
  preparePayload(
    parentHash: Root,
    timestamp: number,
    random: Bytes32,
    feeRecipient: ExecutionAddress
  ): Promise<PayloadId>;

  /**
   * Given the payload_id, get_payload returns the most recent version of the execution payload that has been built
   * since the corresponding call to prepare_payload method.
   *
   * Required for block producing
   * https://github.com/ethereum/consensus-specs/blob/dev/specs/merge/validator.md#get_payload
   */
  getPayload(payloadId: PayloadId): Promise<merge.ExecutionPayload>;
}
