export class ApiError extends Error {
  status: number;
  operationId?: string;

  constructor(message: string, status: number, operationId: string) {
    super(`${message} status=${status}, operationId=${operationId}`);
    this.operationId = operationId;
    this.status = status;
  }
}
