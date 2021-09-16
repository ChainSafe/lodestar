import {Bytes32, merge, Root} from "@chainsafe/lodestar-types";

/**
 * Execution engine represents an abstract protocol to interact with execution clients. Potential transports include:
 * - JSON RPC over network
 * - IPC
 * - Integrated code into the same binary
 */
export interface IExecutionEngine {
  /**
   * Returns ``True`` iff ``execution_payload`` is valid with respect to ``self.execution_state``.
   *
   * Required for block processing in the beacon state transition function.
   * https://github.com/ethereum/consensus-specs/blob/0eb0a934a3/specs/merge/beacon-chain.md#on_payload
   *
   * Should be called in advance before, after or in parallel to block processing
   */
  onPayload(executionPayload: merge.ExecutionPayload): Promise<boolean>;

  /**
   * Returns True if the ``block_hash`` was successfully set as head of the execution payload chain.
   *
   * Required as a side-effect of the fork-choice when setting a new head.
   * https://github.com/ethereum/consensus-specs/blob/0eb0a934a3/specs/merge/fork-choice.md#set_head
   *
   * Can be called in response to a fork-choice head event
   */
  setHead(blockHash: Root): Promise<boolean>;

  /**
   * Returns True if the data up to and including ``block_hash`` was successfully finalized.
   *
   * Required as a side-effect of the fork-choice when setting a new finalized checkpoint.
   * https://github.com/ethereum/consensus-specs/blob/0eb0a934a3/specs/merge/fork-choice.md#finalize_block
   *
   * Can be called in response to a fork-choice finalized event
   */
  finalizeBlock(blockHash: Root): Promise<boolean>;

  /**
   * Produces a new instance of an execution payload, with the specified timestamp, on top of the execution payload
   * chain tip identified by block_hash.
   *
   * Required for block producing
   * https://github.com/ethereum/consensus-specs/blob/0eb0a934a3/specs/merge/validator.md#assemble_block
   *
   * Must be called close to the slot associated with the validator's block producing to get the blockHash and
   * random correct
   */
  assembleBlock(blockHash: Root, timestamp: number, random: Bytes32): Promise<merge.ExecutionPayload>;
}

export class ExecutionEngineDisabled implements IExecutionEngine {
  async onPayload(): Promise<boolean> {
    throw Error("Execution engine disabled");
  }

  async setHead(): Promise<boolean> {
    throw Error("Execution engine disabled");
  }

  async finalizeBlock(): Promise<boolean> {
    throw Error("Execution engine disabled");
  }

  async assembleBlock(): Promise<merge.ExecutionPayload> {
    throw Error("Execution engine disabled");
  }
}
