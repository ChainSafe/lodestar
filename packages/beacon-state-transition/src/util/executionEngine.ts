import {bellatrix} from "@chainsafe/lodestar-types";

export type ExecutionEngine = {
  /**
   * Returns ``True`` iff ``execution_payload`` is valid with respect to ``self.execution_state``.
   *
   * Note: `processExecutionPayload()` depends on process_randao function call as it retrieves the most recent randao
   * mix from the state. Implementations that are considering parallel processing of execution payload with respect to
   * beacon chain state transition function should work around this dependency.
   */
  notifyNewPayload(executionPayload: bellatrix.ExecutionPayload): boolean;
};
