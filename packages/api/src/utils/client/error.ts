/** Failure of a single item of a batch request, `index` refers to the submitted array */
export type ApiFailure = {index: number; message: string};

export class ApiError extends Error {
  status: number;
  operationId: string;
  /** Set if the server rejected only some items of a batch request */
  failures?: ApiFailure[];

  constructor(message: string, status: number, operationId: string, failures?: ApiFailure[]) {
    super(`${operationId} failed with status ${status}: ${message}`);
    this.status = status;
    this.operationId = operationId;
    this.failures = failures;
  }
}
