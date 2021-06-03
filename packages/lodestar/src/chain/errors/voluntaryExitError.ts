import {LodestarError} from "@chainsafe/lodestar-utils";

export enum VoluntaryExitErrorCode {
  EXIT_ALREADY_EXISTS = "VOLUNTARY_EXIT_ERROR_EXIT_ALREADY_EXISTS",
  INVALID_EXIT = "VOLUNTARY_EXIT_ERROR_INVALID_EXIT",
}
export type VoluntaryExitErrorType =
  | {code: VoluntaryExitErrorCode.EXIT_ALREADY_EXISTS}
  | {code: VoluntaryExitErrorCode.INVALID_EXIT; error: Error};

export class VoluntaryExitError extends LodestarError<VoluntaryExitErrorType> {
  constructor(type: VoluntaryExitErrorType) {
    super(type);
  }
}
