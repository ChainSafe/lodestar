import {Root, Slot, ValidatorIndex} from "@lodestar/types";
import {GossipActionError} from "./gossipValidation.js";

export enum InclusionListErrorCode {
  MAXIMUM_SIZE_EXCEEDED = "INCLUSION_LIST_ERROR_MAXIMUM_SIZE_EXCEEDED",
  INVALID_SLOT = "INCLUSION_LIST_ERROR_INVALID_SLOT",
  MORE_THAN_TWO = "INCLUSION_LIST_ERROR_MORE_THAN_TWO",
  VALIDATOR_NOT_IN_COMMITTEE = "INCLUSION_LIST_ERROR_VALIDATOR_NOT_IN_COMMITTEE",
  INVALID_COMMITTEE_ROOT = "INCLUSION_LIST_ERROR_INVALID_COMMITTEE_ROOT",
  INVALID_SIGNATURE = "INCLUSION_LIST_ERROR_INVALID_SIGNATURE",
  PRE_HEZE_SLOT = "INCLUSION_LIST_ERROR_PRE_HEZE_SLOT",
}

export type InclusionListErrorType =
  | {code: InclusionListErrorCode.MAXIMUM_SIZE_EXCEEDED; inclusionListSize: number; sizeLimit: number}
  | {code: InclusionListErrorCode.INVALID_SLOT; inclusionListSlot: Slot; currentSlot: Slot}
  | {code: InclusionListErrorCode.MORE_THAN_TWO; validatorIndex: ValidatorIndex}
  | {code: InclusionListErrorCode.VALIDATOR_NOT_IN_COMMITTEE; validatorIndex: ValidatorIndex}
  | {code: InclusionListErrorCode.INVALID_COMMITTEE_ROOT; received: Root; expected: Root}
  | {code: InclusionListErrorCode.INVALID_SIGNATURE}
  | {code: InclusionListErrorCode.PRE_HEZE_SLOT; inclusionListSlot: Slot};

export class InclusionListError extends GossipActionError<InclusionListErrorType> {}
