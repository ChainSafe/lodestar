import {LogLevel} from "@lodestar/utils";
import {BlockErrorCode} from "../../errors/index.js";
import {PayloadErrorCode} from "../importExecutionPayload.js";
import {isPeerAttributableFailure} from "./peerAttributableError.js";

export type BlockErrorLogLevel = LogLevel.error | LogLevel.warn | LogLevel.debug;

/**
 * Log level of a block or payload import error. Most of them are expected during normal operation, the block is
 * already known, its parent is not known yet, its data is not available yet, the execution client is offline (which
 * is reported separately), so they are only useful at debug level. An invalid block or payload, or an internal error,
 * is rare and may leave the node stuck if it is served for the canonical chain, so it is surfaced.
 */
export function getBlockErrorLogLevel(code: BlockErrorCode | PayloadErrorCode): BlockErrorLogLevel {
  switch (code) {
    // not caused by the block, something is wrong on our side
    case BlockErrorCode.BEACON_CHAIN_ERROR:
    case BlockErrorCode.PRESTATE_MISSING:
      return LogLevel.error;
    // the block violates a consensus rule, a fault of the proposer or of the peer that served it
    case BlockErrorCode.INCORRECT_PROPOSER:
    case BlockErrorCode.PROPOSAL_SIGNATURE_INVALID:
    case BlockErrorCode.UNKNOWN_PROPOSER:
    case BlockErrorCode.NOT_LATER_THAN_PARENT:
    case BlockErrorCode.STATE_ROOT_MISMATCH:
    case BlockErrorCode.INCORRECT_TIMESTAMP:
    case BlockErrorCode.TOO_MUCH_GAS_USED:
    case BlockErrorCode.SAME_PARENT_HASH:
    case BlockErrorCode.TRANSACTIONS_TOO_BIG:
    case BlockErrorCode.TOO_MANY_KZG_COMMITMENTS:
    case BlockErrorCode.TOO_MANY_BLOCK_OPERATIONS:
    case BlockErrorCode.BID_PARENT_ROOT_MISMATCH:
      return LogLevel.warn;
    default:
      // invalid signature or state root, INVALID from the execution client, inconsistent segment, ...
      return isPeerAttributableFailure(code) ? LogLevel.warn : LogLevel.debug;
  }
}
