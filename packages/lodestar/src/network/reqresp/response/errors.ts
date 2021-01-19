import {LodestarError} from "@chainsafe/lodestar-utils";
import {RpcResponseStatus, RpcResponseStatusError} from "../../../constants";

type RpcResponseStatusNotSuccess = Exclude<RpcResponseStatus, RpcResponseStatus.SUCCESS>;

export enum ResponseErrorCode {
  RESPONSE_STATUS_ERROR = "RESPONSE_STATUS_ERROR",
}

type RequestErrorType = {
  code: ResponseErrorCode;
  status: RpcResponseStatusError;
  errorMessage: string;
};

/**
 * Used internally only to signal a response status error. Since the error should never bubble up to the user,
 * the error code and error message does not matter much.
 */
export class ResponseError extends LodestarError<RequestErrorType> {
  status: RpcResponseStatusNotSuccess;
  errorMessage: string;
  constructor(status: RpcResponseStatusNotSuccess, errorMessage: string) {
    const type = {code: ResponseErrorCode.RESPONSE_STATUS_ERROR, status, errorMessage};
    super(type, `RESPONSE_ERROR_${RpcResponseStatus[status]}: ${errorMessage}`);
    this.status = status;
    this.errorMessage = errorMessage;
  }
}
