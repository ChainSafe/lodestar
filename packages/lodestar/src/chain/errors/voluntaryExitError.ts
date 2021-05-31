import {GossipValidationError} from "./gossipValidation";

export enum VoluntaryExitErrorCode {
  EXIT_ALREADY_EXISTS = "VOLUNTARY_EXIT_ERROR_EXIT_ALREADY_EXISTS",
  INVALID_EXIT = "VOLUNTARY_EXIT_ERROR_INVALID_EXIT",
}
export type VoluntaryExitErrorType =
  | {code: VoluntaryExitErrorCode.EXIT_ALREADY_EXISTS}
  | {code: VoluntaryExitErrorCode.INVALID_EXIT};

export class VoluntaryExitError extends GossipValidationError<VoluntaryExitErrorType> {}
