import {LodestarError} from "@chainsafe/lodestar-utils";

export enum ProposerSlashingErrorCode {
  SLASHING_ALREADY_EXISTS = "PROPOSER_SLASHING_ERROR_SLASHING_ALREADY_EXISTS",
  INVALID_SLASHING = "PROPOSER_SLASHING_ERROR_INVALID_SLASHING",
}
export type ProposerSlashingErrorType =
  | {code: ProposerSlashingErrorCode.SLASHING_ALREADY_EXISTS}
  | {code: ProposerSlashingErrorCode.INVALID_SLASHING};

export class ProposerSlashingError extends LodestarError<ProposerSlashingErrorType> {
  constructor(type: ProposerSlashingErrorType) {
    super(type);
  }
}
