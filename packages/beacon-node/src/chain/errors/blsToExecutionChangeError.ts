import {GossipActionError} from "./gossipValidation.js";

export enum BlsToExecutionChangeErrorCode {
  ALREADY_EXISTS = "BLS_TO_EXECUTION_CHANGE_ERROR_ALREADY_EXISTS",
  INVALID = "BLS_TO_EXECUTION_CHANGE_ERROR_INVALID",
  INVALID_SIGNATURE = "BLS_TO_EXECUTION_CHANGE_ERROR_INVALID_SIGNATURE",
}
export type BlsToExecutionChangeErrorType =
  | {code: BlsToExecutionChangeErrorCode.ALREADY_EXISTS}
  | {code: BlsToExecutionChangeErrorCode.INVALID}
  | {code: BlsToExecutionChangeErrorCode.INVALID_SIGNATURE};

export class BlsToExecutionChangeError extends GossipActionError<BlsToExecutionChangeErrorType> {}
