import {GossipActionError} from "./gossipValidation.js";

export enum LightClientErrorCode {
  UPDATE_ALREADY_FORWARDED = "UPDATE_ALREADY_FORWARDED",
  RECEIVED_TOO_EARLY = "RECEIVED_TOO_EARLY",
}
export type LightClientErrorType =
  | {code: LightClientErrorCode.UPDATE_ALREADY_FORWARDED}
  | {code: LightClientErrorCode.RECEIVED_TOO_EARLY};

export class LightClientError extends GossipActionError<LightClientErrorType> {}
