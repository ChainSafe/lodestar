import {ApiError} from "@lodestar/api/beacon/server";

export {ApiError};

export class StateNotFound extends ApiError {
  constructor() {
    super(404, "State not found");
  }
}
export class DataNotAvailable extends ApiError {
  constructor() {
    super(404, "Requested data cannot be served");
  }
}

export class ValidationError extends ApiError {
  dataPath?: string;
  constructor(message?: string, dataPath?: string) {
    super(400, message);
    this.dataPath = dataPath;
  }
}

// Spec requires 503 - https://github.com/ethereum/beacon-APIs/blob/e68a954e1b6f6eb5421abf4532c171ce301c6b2e/types/http.yaml#L62
export class NodeIsSyncing extends ApiError {
  constructor(statusMsg: string) {
    super(503, `Node is syncing - ${statusMsg}`);
  }
}

// Error thrown by beacon node APIs that are only supported by distributed validator middleware clients
// For example https://github.com/ethereum/beacon-APIs/blob/f087fbf2764e657578a6c29bdf0261b36ee8db1e/apis/validator/beacon_committee_selections.yaml
export class OnlySupportedByDVT extends ApiError {
  constructor() {
    super(501, "Only supported by distributed validator middleware clients");
  }
}
