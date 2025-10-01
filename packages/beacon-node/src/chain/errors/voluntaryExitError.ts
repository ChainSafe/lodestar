import { VoluntaryExitValidity } from "@lodestar/state-transition";
import {GossipActionError} from "./gossipValidation.js";

export enum VoluntaryExitErrorCode {
  ALREADY_EXISTS = "VOLUNTARY_EXIT_ERROR_ALREADY_EXISTS",
  INVALID = "VOLUNTARY_EXIT_ERROR_INVALID",
  INACTIVE = "VOLUNTARY_EXIT_ERROR_INACTIVE",
  ALREADY_EXITED = "VOLUNTARY_EXIT_ERROR_ALREADY_EXITED",
  EARLY_EPOCH = "VOLUNTARY_EXIT_ERROR_EARLY_EPOCH",
  SHORT_TIME_ACTIVE = "VOLUNTARY_EXIT_ERROR_SHORT_TIME_ACTIVE",
  INVALID_SIGNATURE = "VOLUNTARY_EXIT_ERROR_INVALID_SIGNATURE",
}
export type VoluntaryExitErrorType =
  | {code: VoluntaryExitErrorCode.ALREADY_EXISTS}
  | {code: VoluntaryExitErrorCode.INVALID}
  | {code: VoluntaryExitErrorCode.INVALID_SIGNATURE}
  | {code: VoluntaryExitErrorCode.INACTIVE}
  | {code: VoluntaryExitErrorCode.ALREADY_EXITED}
  | {code: VoluntaryExitErrorCode.EARLY_EPOCH} 
  | {code: VoluntaryExitErrorCode.SHORT_TIME_ACTIVE}

export class VoluntaryExitError extends GossipActionError<VoluntaryExitErrorType> {}

export function mapValidityToErrorCode(validity: VoluntaryExitValidity): VoluntaryExitErrorCode {
  switch (validity) {
    case VoluntaryExitValidity.inactive:
      return VoluntaryExitErrorCode.INACTIVE;
    case VoluntaryExitValidity.alreadyExited:
      return VoluntaryExitErrorCode.ALREADY_EXITED;
    case VoluntaryExitValidity.earlyEpoch:
      return VoluntaryExitErrorCode.EARLY_EPOCH;
    case VoluntaryExitValidity.shortTimeActive:
      return VoluntaryExitErrorCode.SHORT_TIME_ACTIVE;
    case VoluntaryExitValidity.invalidSignature:
      return VoluntaryExitErrorCode.INVALID_SIGNATURE;
    case VoluntaryExitValidity.pendingWithdrawals:
      return VoluntaryExitErrorCode.INVALID;
    default:
      return VoluntaryExitErrorCode.INVALID;
  }
}