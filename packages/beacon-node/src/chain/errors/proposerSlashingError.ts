import {GossipActionError} from "./gossipValidation.js";

export enum ProposerSlashingErrorCode {
  ALREADY_EXISTS = "PROPOSER_SLASHING_ERROR_ALREADY_EXISTS",
  INVALID = "PROPOSER_SLASHING_ERROR_INVALID",
  INVALID_SIGNATURE = "PROPOSER_SLASHING_ERROR_INVALID_SIGNATURE",
}
export type ProposerSlashingErrorType =
  | {code: ProposerSlashingErrorCode.ALREADY_EXISTS}
  | {code: ProposerSlashingErrorCode.INVALID; error: Error}
  | {code: ProposerSlashingErrorCode.INVALID_SIGNATURE};

export class ProposerSlashingError extends GossipActionError<ProposerSlashingErrorType> {}
