import {GossipActionError} from "./gossipValidation.js";

export enum BLSToExecutionChangeErrorCode {
  ALREADY_EXISTS = "BLS_TO_EXECUTION_CHANGE_ERROR_ALREADY_EXISTS",
  INVALID = "BLS_TO_EXECUTION_CHANGE_ERROR_INVALID",
  INVALID_SIGNATURE = "BLS_TO_EXECUTION_CHANGE_ERROR_INVALID_SIGNATURE",
}
export type BLSToExecutionChangeErrorType =
  | {code: BLSToExecutionChangeErrorCode.ALREADY_EXISTS}
  | {code: BLSToExecutionChangeErrorCode.INVALID}
  | {code: BLSToExecutionChangeErrorCode.INVALID_SIGNATURE};

export class BLSToExecutionChangeError extends GossipActionError<BLSToExecutionChangeErrorType> {}
