import {LodestarError, LodestarErrorMetaData, LodestarErrorObject} from "@lodestar/utils";
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
export class ResponseError extends LodestarError<RequestErrorType> {
  status: RpcResponseStatusNotSuccess;
  errorMessage: string;
  constructor(status: RpcResponseStatusNotSuccess, errorMessage: string, stack?: string) {
    const type = {code: ResponseErrorCode.RESPONSE_STATUS_ERROR, status, errorMessage};
    super(type, `RESPONSE_ERROR_${RespStatus[status]}: ${errorMessage}`, stack);
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

    return new ResponseError(
      obj.type.status as RpcResponseStatusNotSuccess,
      obj.type.errorMessage as string,
      obj.stack
    );
  }
}
