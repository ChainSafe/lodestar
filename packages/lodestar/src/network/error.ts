import {RpcResponseStatus} from "../constants";

/**
 * Error of network req/resp
 */

export class RpcError extends Error {
  public status: RpcResponseStatus;
  constructor(status: RpcResponseStatus, message?: string) {
    super(message);
    this.status = status;
  }
}
