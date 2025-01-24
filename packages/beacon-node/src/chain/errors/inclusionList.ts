import {Slot, ValidatorIndex} from "@lodestar/types";
import {GossipActionError} from "./gossipValidation.js";

export enum InclusionListErrorCode {
  MAXIMUM_SIZE_EXCEEDED = "INCLUSION_LIST_ERROR_MAXIMUM_SIZE_EXCEEDED",
  INVALID_SLOT = "INCLUSION_LIST_ERROR_INVALID_SLOT",
  NOT_TIMELY = "INCLUSION_LIST_ERROR_NOT_TIMELY",
  INVALID_COMMITTEE_ROOT = "INCLUSION_LIST_ERROR_INVALID_COMMITTEE_ROOT",
  VALIDATOR_NOT_IN_COMMITTEE = "INCLUSION_LIST_ERROR_VALIDATOR_NOT_IN_COMMITTEE",
  TOO_MANY_TRANSACTIONS = "INCLUSION_LIST_ERROR_TOO_MANY_TRANSACTIONS",
  SPAM = "INCLUSION_LIST_ERROR_SPAM",
  INVALID_SIGNATURE = "INCLUSION_LIST_ERROR_INVALID_SIGNATURE",
  MORE_THAN_TWO = "INCLUSION_LIST_ERROR_MORE_THAN_TWO",
}
export type InclusionListErrorType =
  | {code: InclusionListErrorCode.MAXIMUM_SIZE_EXCEEDED; inclusionListSize: number; sizeLimit: number}
  | {code: InclusionListErrorCode.INVALID_SLOT; inclusionListSlot: Slot; currentSlot: Slot}
  | {code: InclusionListErrorCode.NOT_TIMELY}
  | {code: InclusionListErrorCode.INVALID_COMMITTEE_ROOT}
  | {code: InclusionListErrorCode.VALIDATOR_NOT_IN_COMMITTEE}
  | {code: InclusionListErrorCode.TOO_MANY_TRANSACTIONS; numTransactions: number; transactionLimit: number}
  | {code: InclusionListErrorCode.SPAM}
  | {code: InclusionListErrorCode.INVALID_SIGNATURE}
  | {code: InclusionListErrorCode.MORE_THAN_TWO; validatorIndex: ValidatorIndex};

export class InclusionListError extends GossipActionError<InclusionListErrorType> {}
