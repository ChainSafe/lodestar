import {HttpErrorCodes} from "./httpStatusCode.js";

export class ApiError extends Error {
  status: number;
  operationId: string;

  constructor(message: string, status: number, operationId: string) {
    super(`${operationId} failed with status ${status}: ${message}`);
    this.operationId = operationId;
    this.status = status;
  }
}

export class ServerError extends Error {
  statusCode: HttpErrorCodes;
  constructor(statusCode: HttpErrorCodes, message?: string) {
    super(message);
    this.statusCode = statusCode;
  }
}
