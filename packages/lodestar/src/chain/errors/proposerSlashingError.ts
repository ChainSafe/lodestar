import {GossipActionError} from "./gossipValidation";

export enum ProposerSlashingErrorCode {
  ALREADY_EXISTS = "PROPOSER_SLASHING_ERROR_ALREADY_EXISTS",
  INVALID = "PROPOSER_SLASHING_ERROR_INVALID",
}
export type ProposerSlashingErrorType =
  | {code: ProposerSlashingErrorCode.ALREADY_EXISTS}
  | {code: ProposerSlashingErrorCode.INVALID; error: Error};

export class ProposerSlashingError extends GossipActionError<ProposerSlashingErrorType> {}
