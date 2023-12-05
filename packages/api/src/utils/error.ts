export class ApiError extends Error {
  status: number;
  operationId?: string;

  constructor(message: string, status: number, operationId: string) {
    super(`Request ${operationId} failed with status ${status}: ${message}`);
    this.operationId = operationId;
    this.status = status;
  }
}
