import {GossipActionError} from "./gossipValidation";

export enum AttesterSlashingErrorCode {
  ALREADY_EXISTS = "ATTESTATION_SLASHING_ERROR_ALREADY_EXISTS",
  INVALID = "ATTESTATION_SLASHING_ERROR_INVALID",
}
export type AttesterSlashingErrorType =
  | {code: AttesterSlashingErrorCode.ALREADY_EXISTS}
  | {code: AttesterSlashingErrorCode.INVALID; error: Error};

export class AttesterSlashingError extends GossipActionError<AttesterSlashingErrorType> {}
