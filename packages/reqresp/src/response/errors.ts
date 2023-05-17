import {ClonableLodestarError, LodestarErrorMetaData, LodestarErrorObject} from "@lodestar/utils";
import {RespStatus, RpcResponseStatusError} from "../interface.js";

type RpcResponseStatusNotSuccess = Exclude<RespStatus, RespStatus.SUCCESS>;

export enum ResponseErrorCode {
  RESPONSE_STATUS_ERROR = "RESPONSE_STATUS_ERROR",
}

type RequestErrorType = {
  code: ResponseErrorCode;
  status: RpcResponseStatusError;
  errorMessage: string;
};

export const RESPONSE_ERROR_CLASS_NAME = "ResponseError";

/**
 * Used internally only to signal a response status error. Since the error should never bubble up to the user,
 * the error code and error message does not matter much.
 */
export class ResponseError extends ClonableLodestarError<RequestErrorType> {
  status: RpcResponseStatusNotSuccess;
  errorMessage: string;
  constructor(status: RpcResponseStatusNotSuccess, errorMessage: string) {
    const type = {code: ResponseErrorCode.RESPONSE_STATUS_ERROR, status, errorMessage};
    super(type, `RESPONSE_ERROR_${RespStatus[status]}: ${errorMessage}`);
    this.status = status;
    this.errorMessage = errorMessage;
  }

  getMetadata(): LodestarErrorMetaData {
    return {
      status: this.status,
      errorMessage: this.errorMessage,
    };
  }

  static fromObject(obj: LodestarErrorObject): ResponseError {
    if (obj.className !== RESPONSE_ERROR_CLASS_NAME) {
      throw new Error(`Expected className to be ResponseError, but got ${obj.className}`);
    }

    return new ResponseError(obj.status as RpcResponseStatusNotSuccess, obj.errorMessage as string);
  }
}
