import {Root, Slot, ValidatorIndex} from "@lodestar/types";
import {GossipActionError} from "./gossipValidation.js";

export enum InclusionListErrorCode {
  MAXIMUM_SIZE_EXCEEDED = "INCLUSION_LIST_ERROR_MAXIMUM_SIZE_EXCEEDED",
  INVALID_SLOT = "INCLUSION_LIST_ERROR_INVALID_SLOT",
  NOT_TIMELY = "INCLUSION_LIST_ERROR_NOT_TIMELY",
  INVALID_COMMITTEE_ROOT = "INCLUSION_LIST_ERROR_INVALID_COMMITTEE_ROOT",
  VALIDATOR_NOT_IN_COMMITTEE = "INCLUSION_LIST_ERROR_VALIDATOR_NOT_IN_COMMITTEE",
  SPAM = "INCLUSION_LIST_ERROR_SPAM",
  INVALID_SIGNATURE = "INCLUSION_LIST_ERROR_INVALID_SIGNATURE",
  MORE_THAN_TWO = "INCLUSION_LIST_ERROR_MORE_THAN_TWO",
}
export type InclusionListErrorType =
  | {code: InclusionListErrorCode.MAXIMUM_SIZE_EXCEEDED; inclusionListSize: number; sizeLimit: number}
  | {code: InclusionListErrorCode.INVALID_SLOT; inclusionListSlot: Slot; currentSlot: Slot}
  | {code: InclusionListErrorCode.NOT_TIMELY}
  | {code: InclusionListErrorCode.INVALID_COMMITTEE_ROOT; received: Root; expected: Root}
  | {code: InclusionListErrorCode.VALIDATOR_NOT_IN_COMMITTEE; validatorIndex: number; committee: Uint32Array}
  | {code: InclusionListErrorCode.SPAM}
  | {code: InclusionListErrorCode.INVALID_SIGNATURE}
  | {code: InclusionListErrorCode.MORE_THAN_TWO; validatorIndex: ValidatorIndex};

export class InclusionListError extends GossipActionError<InclusionListErrorType> {}
