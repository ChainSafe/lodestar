export class ApiError extends Error {
  status: number;
  operationId: string;

  constructor(message: string, status: number, operationId: string) {
    super(`${operationId} failed with status ${status}: ${message}`);
    this.status = status;
    this.operationId = operationId;
  }
}
