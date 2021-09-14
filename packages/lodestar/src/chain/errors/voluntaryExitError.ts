import {GossipActionError} from "./gossipValidation";

export enum VoluntaryExitErrorCode {
  ALREADY_EXISTS = "VOLUNTARY_EXIT_ERROR_ALREADY_EXISTS",
  INVALID = "VOLUNTARY_EXIT_ERROR_INVALID",
  INVALID_SIGNATURE = "VOLUNTARY_EXIT_ERROR_INVALID_SIGNATURE",
}
export type VoluntaryExitErrorType =
  | {code: VoluntaryExitErrorCode.ALREADY_EXISTS}
  | {code: VoluntaryExitErrorCode.INVALID}
  | {code: VoluntaryExitErrorCode.INVALID_SIGNATURE};

export class VoluntaryExitError extends GossipActionError<VoluntaryExitErrorType> {}
