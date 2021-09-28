import {Bytes32, merge, Root, ExecutionAddress, PayloadId, RootHex} from "@chainsafe/lodestar-types";

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
  executePayload(executionPayload: merge.ExecutionPayload): Promise<boolean>;

  /**
   * Signals that the beacon block containing the execution payload is valid with respect to the consensus rule set.
   *
   * A call to notify_consensus_validated must be made after the state_transition function finishes. The value of the
   * valid parameter must be set as follows:
   * - True if state_transition function call succeeds
   * - False if state_transition function call fails
   *
   * Note: The call of the notify_consensus_validated function with valid = True maps on the POS_CONSENSUS_VALIDATED event defined in the EIP-3675.
   * https://github.com/ethereum/consensus-specs/blob/dev/specs/merge/beacon-chain.md#notify_consensus_validated
   */
  notifyConsensusValidated(blockHash: Root, valid: boolean): Promise<void>;

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
