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
