import {LodestarError} from "@chainsafe/lodestar-utils";

export enum ProposerSlashingErrorCode {
  ERR_SLASHING_ALREADY_EXISTS = "ERR_SLASHING_ALREADY_EXISTS",
  ERR_INVALID_SLASHING = "ERR_INVALID_SLASHING",
}
export type ProposerSlashingErrorType =
  | {
      code: ProposerSlashingErrorCode.ERR_SLASHING_ALREADY_EXISTS;
    }
  | {
      code: ProposerSlashingErrorCode.ERR_INVALID_SLASHING;
    };

export class ProposerSlashingError extends LodestarError<ProposerSlashingErrorType> {
  constructor(type: ProposerSlashingErrorType) {
    super(type);
  }
}
