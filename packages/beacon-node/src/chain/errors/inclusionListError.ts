import {Slot, RootHex, ValidatorIndex} from "@lodestar/types";
import {GossipActionError} from "./gossipValidation.js";

export enum InclusionListErrorCode {
  ALREADY_KNOWN = "INCLUSION_LIST_ERROR_ALREADY_KNOWN",
  PARENT_UNKNOWN = "INCLUSION_LIST_ERROR_PARENT_UNKNOWN",
  NOT_LATER_THAN_PARENT = "INCLUSION_LIST_ERROR_NOT_LATER_THAN_PARENT",
  PROPOSAL_SIGNATURE_INVALID = "INCLUSION_LIST_ERROR_PROPOSAL_SIGNATURE_INVALID",
  INCORRECT_PROPOSER = "INCLUSION_LIST_INCORRECT_PROPOSER",
  EXECUTION_ENGINE_ERROR = "INCLUSION_LIST_EXECUTION_ENGINE_ERROR",
}

export type InclusionListErrorType =
  | {code: InclusionListErrorCode.ALREADY_KNOWN; root: RootHex}
  | {code: InclusionListErrorCode.PARENT_UNKNOWN; parentRoot: RootHex}
  | {code: InclusionListErrorCode.NOT_LATER_THAN_PARENT; parentSlot: Slot; slot: Slot}
  | {code: InclusionListErrorCode.PROPOSAL_SIGNATURE_INVALID}
  | {code: InclusionListErrorCode.INCORRECT_PROPOSER; proposerIndex: ValidatorIndex}
  | {code: InclusionListErrorCode.EXECUTION_ENGINE_ERROR};

export class InclusionListGossipError extends GossipActionError<InclusionListErrorType> {}
