import {LodestarError} from "@chainsafe/lodestar-utils";

export enum VoluntaryExitErrorCode {
  ERR_EXIT_ALREADY_EXISTS = "ERR_EXIT_ALREADY_EXISTS",
  ERR_INVALID_EXIT = "ERR_INVALID_EXIT",
}
export type VoluntaryExitErrorType =
  | {code: VoluntaryExitErrorCode.ERR_EXIT_ALREADY_EXISTS}
  | {code: VoluntaryExitErrorCode.ERR_INVALID_EXIT};

export class VoluntaryExitError extends LodestarError<VoluntaryExitErrorType> {
  constructor(type: VoluntaryExitErrorType) {
    super(type);
  }
}
