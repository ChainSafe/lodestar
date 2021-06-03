import {LodestarError} from "@chainsafe/lodestar-utils";

export enum VoluntaryExitErrorCode {
  ALREADY_EXISTS = "VOLUNTARY_EXIT_ERROR_ALREADY_EXISTS",
  INVALID = "VOLUNTARY_EXIT_ERROR_INVALID",
}
export type VoluntaryExitErrorType =
  | {code: VoluntaryExitErrorCode.ALREADY_EXISTS}
  | {code: VoluntaryExitErrorCode.INVALID; error: Error};

export class VoluntaryExitError extends LodestarError<VoluntaryExitErrorType> {
  constructor(type: VoluntaryExitErrorType) {
    super(type);
  }
}
