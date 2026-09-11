import {GossipActionError} from "./gossipValidation.js";

export enum BlsToExecutionChangeErrorCode {
  ALREADY_EXISTS = "BLS_TO_EXECUTION_CHANGE_ERROR_ALREADY_EXISTS",
  INVALID = "BLS_TO_EXECUTION_CHANGE_ERROR_INVALID",
  INVALID_SIGNATURE = "BLS_TO_EXECUTION_CHANGE_ERROR_INVALID_SIGNATURE",
  PRE_CAPELLA = "BLS_TO_EXECUTION_CHANGE_ERROR_PRE_CAPELLA",
}
export type BlsToExecutionChangeErrorType =
  | {code: BlsToExecutionChangeErrorCode.ALREADY_EXISTS}
  | {code: BlsToExecutionChangeErrorCode.INVALID}
  | {code: BlsToExecutionChangeErrorCode.INVALID_SIGNATURE}
  | {code: BlsToExecutionChangeErrorCode.PRE_CAPELLA};

export class BlsToExecutionChangeError extends GossipActionError<BlsToExecutionChangeErrorType> {}
