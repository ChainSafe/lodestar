import {RpcResponseStatus} from "../constants";
import {RpcScoreEvent, IRpcScoreTracker} from "./peers/score";
import PeerId from "peer-id";

/**
 * Error of network req/resp
 */

export class RpcError extends Error {
  public status: RpcResponseStatus;
  constructor(status: RpcResponseStatus, message?: string) {
    super(message);
    this.status = status;
  }
}

export const RESPONSE_TIMEOUT_ERR = "response timeout";
export const REQUEST_TIMEOUT_ERR = "request timeout";

export function isResponseTimeout(err: Error): boolean {
  return err.message.includes(RESPONSE_TIMEOUT_ERR);
}

export function updateRpcScore(scoreTracker: IRpcScoreTracker, peer: PeerId, e: Error): void {
  if (isResponseTimeout(e)) {
    scoreTracker.update(peer, RpcScoreEvent.RESPONSE_TIMEOUT);
  } else if (e.message.includes("ERR_UNSUPPORTED_PROTOCOL")) {
    scoreTracker.update(peer, RpcScoreEvent.UNSUPPORTED_PROTOCOL);
  } else {
    scoreTracker.update(peer, RpcScoreEvent.UNKNOWN_ERROR);
  }
}
