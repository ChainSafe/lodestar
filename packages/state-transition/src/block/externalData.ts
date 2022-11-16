export enum ExecutionPayloadStatus {
  preMerge = "preMerge",
  invalid = "invalid",
  valid = "valid",
}

export enum DataAvailableStatus {
  preEIP4844 = "preEIP4844",
  notAvailable = "notAvailable",
  available = "available",
}

export interface BlockExternalData {
  executionPayloadStatus: ExecutionPayloadStatus;
  dataAvailableStatus: DataAvailableStatus;
}
