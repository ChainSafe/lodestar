import {RpcErrorCode} from "../constants";

/**
 * Error of network req/resp
 */

export class RpcError extends Error {
  public status: RpcErrorCode;
  constructor(status: RpcErrorCode, message?: string) {
    super(message);
    this.status = status;
  }
}
