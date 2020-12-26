import {RpcResponseStatus} from "../../constants";

type RpcResponseStatusNotSuccess = Exclude<RpcResponseStatus, RpcResponseStatus.SUCCESS>;

/**
 * Error of network req/resp
 */
export class ReqRespError extends Error {
  public status: RpcResponseStatusNotSuccess;
  constructor(status: RpcResponseStatusNotSuccess, message?: string) {
    super(message);
    this.status = status;
  }
}
