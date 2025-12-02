/**
 * Should emulate the return value of `ExecutionEngine.notifyNewPayload()`, such that:
 *
 * Returns ``True`` iff ``execution_payload`` is valid with respect to ``self.execution_state``.
 *
 * Note: `processExecutionPayload()` depends on process_randao function call as it retrieves the most recent randao
 * mix from the state. Implementations that are considering parallel processing of execution payload with respect to
 * beacon chain state transition function should work around this dependency.
 */
export enum ExecutionPayloadStatus {
  preMerge = "preMerge",
  invalid = "invalid",
  valid = "valid",
}

export enum DataAvailabilityStatus {
  PreData = "PreData",
  /* validator activities can't be performed on out of range data */
  OutOfRange = "OutOfRange",
  Available = "Available",
}

export interface BlockExternalData {
  executionPayloadStatus: ExecutionPayloadStatus;
  dataAvailabilityStatus: DataAvailabilityStatus;
}
