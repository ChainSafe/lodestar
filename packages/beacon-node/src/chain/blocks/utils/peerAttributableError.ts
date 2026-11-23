import {BlockErrorCode} from "../../errors/index.js";
import {PayloadErrorCode} from "../importExecutionPayload.js";

/**
 * Whether a block or payload error is caused by the data a peer served rather than by our own state or the
 * execution client being unavailable. Range sync attributes these failures to the peer and drops the inputs from the
 * seen caches so a retry downloads them again.
 */
export function isPeerAttributableFailure(code: BlockErrorCode | PayloadErrorCode | null): boolean {
  switch (code) {
    // EL returned a definitive INVALID verdict on the payload
    case BlockErrorCode.EXECUTION_ENGINE_INVALID:
    case PayloadErrorCode.EXECUTION_ENGINE_INVALID:
    // a block or envelope signature is invalid
    case BlockErrorCode.INVALID_SIGNATURE:
    case PayloadErrorCode.INVALID_SIGNATURE:
    // the block's state transition produced an invalid state root, or failed per_slot/per_block processing
    case BlockErrorCode.INVALID_STATE_ROOT:
    case BlockErrorCode.PER_BLOCK_PROCESSING_ERROR:
    // the segment this peer served is internally inconsistent (in-segment link breaks, see PR #9684)
    case BlockErrorCode.NON_LINEAR_SLOTS:
    case BlockErrorCode.NON_LINEAR_PARENT_ROOTS:
    case BlockErrorCode.NON_LINEAR_PAYLOAD_ROOTS:
    // the envelope references a mismatched block root, or fails field verification
    case BlockErrorCode.ENVELOPE_BLOCK_ROOT_MISMATCH:
    case PayloadErrorCode.ENVELOPE_VERIFICATION_ERROR:
    // the peer served a block we have explicitly blacklisted
    case BlockErrorCode.BLACKLISTED_BLOCK:
      return true;
    default:
      return false;
  }
}
