import {LodestarError} from "@lodestar/utils";
import {GossipActionError} from "./gossipValidation.js";

export enum LightClientErrorCode {
  FINALITY_UPDATE_ALREADY_FORWARDED = "FINALITY_UPDATE_ALREADY_FORWARDED",
  OPTIMISTIC_UPDATE_ALREADY_FORWARDED = "OPTIMISTIC_UPDATE_ALREADY_FORWARDED",
  FINALITY_UPDATE_RECEIVED_TOO_EARLY = "FINALITY_UPDATE_RECEIVED_TOO_EARLY",
  OPTIMISTIC_UPDATE_RECEIVED_TOO_EARLY = "OPTIMISTIC_UPDATE_RECEIVED_TOO_EARLY",
  FINALITY_UPDATE_NOT_MATCHING_LOCAL = "FINALITY_UPDATE_NOT_MATCHING_LOCAL",
  OPTIMISTIC_UPDATE_NOT_MATCHING_LOCAL = "OPTIMISTIC_UPDATE_NOT_MATCHING_LOCAL",
}
export type LightClientErrorType =
  | {code: LightClientErrorCode.FINALITY_UPDATE_ALREADY_FORWARDED}
  | {code: LightClientErrorCode.OPTIMISTIC_UPDATE_ALREADY_FORWARDED}
  | {code: LightClientErrorCode.FINALITY_UPDATE_RECEIVED_TOO_EARLY}
  | {code: LightClientErrorCode.OPTIMISTIC_UPDATE_RECEIVED_TOO_EARLY}
  | {code: LightClientErrorCode.FINALITY_UPDATE_NOT_MATCHING_LOCAL}
  | {code: LightClientErrorCode.OPTIMISTIC_UPDATE_NOT_MATCHING_LOCAL};

export class LightClientError extends GossipActionError<LightClientErrorType> {}

// Errors for the light client server

export enum LightClientServerErrorCode {
  RESOURCE_UNAVAILABLE = "RESOURCE_UNAVAILABLE",
}

export type LightClientServerErrorType = {code: LightClientServerErrorCode.RESOURCE_UNAVAILABLE};

export class LightClientServerError extends LodestarError<LightClientServerErrorType> {}
