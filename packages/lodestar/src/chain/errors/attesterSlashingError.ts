import {LodestarError} from "@chainsafe/lodestar-utils";

export enum AttesterSlashingErrorCode {
  ERR_SLASHING_ALREADY_EXISTS = "ERR_SLASHING_ALREADY_EXISTS",
  ERR_INVALID_SLASHING = "ERR_INVALID_SLASHING",
}
export type AttesterSlashingErrorType =
  | {
      code: AttesterSlashingErrorCode.ERR_SLASHING_ALREADY_EXISTS;
    }
  | {
      code: AttesterSlashingErrorCode.ERR_INVALID_SLASHING;
    };

export class AttesterSlashingError extends LodestarError<AttesterSlashingErrorType> {
  constructor(type: AttesterSlashingErrorType) {
    super(type);
  }
}
