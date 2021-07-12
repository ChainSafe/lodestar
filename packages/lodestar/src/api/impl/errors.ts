export class ApiError extends Error {
  statusCode: number;
  constructor(statusCode: number, message?: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

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

// Spec requires 503 - https://github.com/ethereum/eth2.0-APIs/blob/e68a954e1b6f6eb5421abf4532c171ce301c6b2e/types/http.yaml#L62
export class NodeIsSyncing extends ApiError {
  constructor(statusMsg: string) {
    super(503, `Node is syncing - ${statusMsg}`);
  }
}
