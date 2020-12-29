import {RpcResponseStatus} from "../../../constants";

type RpcResponseStatusNotSuccess = Exclude<RpcResponseStatus, RpcResponseStatus.SUCCESS>;

/**
 * ReqResp response error, necessary to internally signal that a request is invalid
 */
export class ResponseError extends Error {
  public status: RpcResponseStatusNotSuccess;
  constructor(status: RpcResponseStatusNotSuccess, message?: string) {
    super(message);
    this.status = status;
  }
}
