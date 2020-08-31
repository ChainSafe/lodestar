import {RpcResponseStatus} from "../constants";
import {BlockProviderScoreEvent, IBlockProviderScoreTracker} from "./peers/score";
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

export function isResponseTimeout(err: Error): boolean {
  return err.message.includes(RESPONSE_TIMEOUT_ERR);
}

export function updateBlockProviderErrorScore(scoreTracker: IBlockProviderScoreTracker, peer: PeerId, e: Error): void {
  if (isResponseTimeout(e)) {
    scoreTracker.update(peer, BlockProviderScoreEvent.RESPONSE_TIMEOUT);
  } else if (e.message.includes("ERR_UNSUPPORTED_PROTOCOL")) {
    scoreTracker.update(peer, BlockProviderScoreEvent.UNSUPPORTED_PROTOCOL);
  } else {
    scoreTracker.update(peer, BlockProviderScoreEvent.UNKNOWN_ERROR);
  }
}
