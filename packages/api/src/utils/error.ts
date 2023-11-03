export class ApiError extends Error {
  status: number;
  operationId?: string;

  constructor(message: string, status: number, operationId?: string) {
    super(message);
    this.status = status;
    this.operationId = operationId;
  }

  toString(): string {
    return `${this.message} (status=${this.status}, operationId=${this.operationId ?? "unknown"})`;
  }
}
