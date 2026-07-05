import {RequestError, RequestErrorCode} from "@lodestar/reqresp";
import {PayloadErrorCode} from "../../chain/blocks/importExecutionPayload.js";
import {BlockErrorCode} from "../../chain/errors/blockError.js";
import {ExecutionPayloadEnvelopeErrorCode} from "../../chain/errors/executionPayloadEnvelope.js";
import {PeerIdStr} from "../../util/peerId.js";
import {QuotaLedger} from "./quotaLedger.js";
import {ParkReason} from "./types.js";

// ---------------------------------------------------------------------------
// TargetSync error policy — the three exhaustive classification switches.
//
// Every fallible edge of the engine funnels through exactly one of these
// tables, so the reaction to every failure is a deliberate, reviewed decision
// rather than a default. All three switches are compile-time exhaustive via
// `satisfies never`: adding a new code to any of the enums fails the build
// here until the new code is classified.
//
// Scoring discipline (invariant I13): attribution is exact or absent. A peer
// is scored only for a specific artifact it served (`scope: "block"` → the
// block's recorded provenance peer) or a specific root it claimed
// (`scope: "chain"` → advocates whose claimed root sits at/above the fault).
// When the faulty artifact cannot be identified, no one is scored.
// ---------------------------------------------------------------------------

/**
 * Reaction to a `BlockError` thrown by `processChainSegment` during a
 * TargetSync segment import.
 */
export type BlockImportAction =
  /** Block already known/finalized — skip and continue. */
  | {action: "benign"}
  /**
   * The chain is provably invalid — target terminal `invalid`.
   * `scope: "block"` — the identified block itself is bad: score its provenance peer Low [A3].
   * `scope: "chain"` — the chain's lineage is bad (finality conflict / invalid parent payload):
   *   score advocates whose claimed root is at/above the fault Mid [A2].
   * `score: false` — invalid for local policy reasons (e.g. blacklist) that are not
   *   provably a peer fault: no one is scored.
   */
  | {action: "invalid"; scope: "block" | "chain"; score: boolean}
  /** Transient — park the target with backoff and resume import. */
  | {action: "park"; reason: ParkReason}
  /** Fork choice moved beneath the walk (finalization advance) — rewalk from the target. */
  | {action: "reanchor"}
  /**
   * Unexpected on this path (assembly bug or a gossip-only code) — park with
   * backoff, warn + meter; the attempt budget converts repeats to `exhausted`.
   * Never scored: an internal fault must not damage peer relationships.
   */
  | {action: "internal"};

export function classifyBlockImportError(code: BlockErrorCode): BlockImportAction {
  switch (code) {
    // -- benign ---------------------------------------------------------------
    case BlockErrorCode.ALREADY_KNOWN:
      return {action: "benign"};

    // -- provably invalid block: score the block's provenance peer [A3] --------
    case BlockErrorCode.STATE_ROOT_MISMATCH:
    case BlockErrorCode.BLOCK_SLOT_LIMIT_REACHED:
    case BlockErrorCode.INCORRECT_PROPOSER:
    case BlockErrorCode.PROPOSAL_SIGNATURE_INVALID:
    case BlockErrorCode.UNKNOWN_PROPOSER:
    case BlockErrorCode.INVALID_SIGNATURE:
    case BlockErrorCode.INVALID_STATE_ROOT:
    case BlockErrorCode.NOT_LATER_THAN_PARENT:
    case BlockErrorCode.PER_BLOCK_PROCESSING_ERROR:
    case BlockErrorCode.KNOWN_BAD_BLOCK:
    case BlockErrorCode.INCORRECT_TIMESTAMP:
    case BlockErrorCode.TOO_MUCH_GAS_USED:
    case BlockErrorCode.SAME_PARENT_HASH:
    case BlockErrorCode.TRANSACTIONS_TOO_BIG:
    case BlockErrorCode.TOO_MANY_KZG_COMMITMENTS:
    case BlockErrorCode.BID_PARENT_ROOT_MISMATCH:
      return {action: "invalid", scope: "block", score: true};

    // -- invalid by local policy: terminal, but not a provable peer fault ------
    case BlockErrorCode.BLACKLISTED_BLOCK:
      return {action: "invalid", scope: "block", score: false};

    // -- provably invalid lineage: advocates of the fault-or-above eat Mid [A2] -
    case BlockErrorCode.NOT_FINALIZED_DESCENDANT:
    case BlockErrorCode.PARENT_EXECUTION_INVALID:
      return {action: "invalid", scope: "chain", score: true};

    // -- transient: park and retry ---------------------------------------------
    case BlockErrorCode.PRESTATE_MISSING:
    case BlockErrorCode.BEACON_CHAIN_ERROR:
      return {action: "park", reason: "backoff"};
    case BlockErrorCode.FUTURE_SLOT:
      // Only reachable at a near-now tip under clock skew; one slot of backoff clears it.
      return {action: "park", reason: "backoff"};
    case BlockErrorCode.EXECUTION_ENGINE_ERROR:
      // "Peers must not be downscored on this code" (blockError.ts) — EL is down/syncing.
      return {action: "park", reason: "elOffline"};
    case BlockErrorCode.DATA_UNAVAILABLE:
      return {action: "park", reason: "awaitingData"};
    case BlockErrorCode.PARENT_PAYLOAD_UNKNOWN:
      return {action: "park", reason: "awaitingParentPayload"};

    // -- fork choice moved beneath us -------------------------------------------
    case BlockErrorCode.PARENT_UNKNOWN:
    case BlockErrorCode.WOULD_REVERT_FINALIZED_SLOT:
      // The segment's anchor is no longer in (non-finalized) fork choice — finalization
      // advanced mid-import. The walk cursor is stale; rewalk from the target.
      return {action: "reanchor"};

    // -- unreachable on the segment path / internal staging faults ---------------
    case BlockErrorCode.GENESIS_BLOCK: // walk floors at the finalized slot ≥ genesis
    case BlockErrorCode.REPEAT_PROPOSAL: // gossip-only equivocation observation
    case BlockErrorCode.NON_LINEAR_PARENT_ROOTS: // linearity is preflighted before submission
    case BlockErrorCode.NON_LINEAR_SLOTS:
    case BlockErrorCode.ENVELOPE_BLOCK_ROOT_MISMATCH: // envelope↔root binding verified at admission
      return {action: "internal"};

    default:
      throw new Error(`classifyBlockImportError: unclassified code ${code satisfies never}`);
  }
}

/**
 * Reaction to an `ExecutionPayloadEnvelopeError` on the by-root envelope fill
 * path (fetch → admit → process).
 */
export type EnvelopeAction =
  /** Nothing to do (already known / block finalized / block itself invalid). */
  | {action: "benign"}
  /** Envelope provably bad against the block's own state — score the serving peer Low. */
  | {action: "rejected"}
  /** Block context not ready — park the fill and retry on wake. */
  | {action: "park"; reason: "awaitingBlock" | "backoff"}
  /** Unexpected on this path — warn + meter, retry with budget, never score. */
  | {action: "internal"};

export function classifyEnvelopeError(code: ExecutionPayloadEnvelopeErrorCode): EnvelopeAction {
  switch (code) {
    case ExecutionPayloadEnvelopeErrorCode.BELONG_TO_FINALIZED_BLOCK:
    case ExecutionPayloadEnvelopeErrorCode.ENVELOPE_ALREADY_KNOWN:
    // The block is invalid — the envelope is moot; the block-side policy owns the reaction.
    case ExecutionPayloadEnvelopeErrorCode.INVALID_BLOCK:
      return {action: "benign"};

    // Provably bad against block-state (unlike the head-state ambiguity that admission
    // DEFERs, these verdicts come from the canonical validator on the block's own state).
    case ExecutionPayloadEnvelopeErrorCode.SLOT_MISMATCH:
    case ExecutionPayloadEnvelopeErrorCode.BUILDER_INDEX_MISMATCH:
    case ExecutionPayloadEnvelopeErrorCode.BLOCK_HASH_MISMATCH:
    case ExecutionPayloadEnvelopeErrorCode.EXECUTION_REQUESTS_ROOT_MISMATCH:
    case ExecutionPayloadEnvelopeErrorCode.INVALID_SIGNATURE:
      return {action: "rejected"};

    case ExecutionPayloadEnvelopeErrorCode.BLOCK_ROOT_UNKNOWN:
      return {action: "park", reason: "awaitingBlock"};
    case ExecutionPayloadEnvelopeErrorCode.PARENT_UNKNOWN:
    case ExecutionPayloadEnvelopeErrorCode.UNKNOWN_BLOCK_STATE:
      return {action: "park", reason: "backoff"};

    case ExecutionPayloadEnvelopeErrorCode.PAYLOAD_ENVELOPE_INPUT_MISSING:
      return {action: "internal"};

    default:
      throw new Error(`classifyEnvelopeError: unclassified code ${code satisfies never}`);
  }
}

/**
 * Reaction to a `PayloadError` from `chain.processExecutionPayload` on the
 * by-root envelope fill path (the import-side enum, distinct from the gossip
 * validation enum above).
 */
export type PayloadImportAction =
  /** Envelope provably bad against the block's own state — score the serving peer Low. */
  | {action: "rejected"}
  /**
   * The builder produced an EL-invalid payload. The envelope is authentic (it passed
   * bid-binding + signature), so the SERVING peer is not at fault — drop, no score.
   */
  | {action: "builderFault"}
  /** Context not ready (block unimported / state missing / EL down) — park and retry. */
  | {action: "park"; reason: "awaitingBlock" | "backoff" | "elOffline"};

export function classifyPayloadImportError(code: PayloadErrorCode): PayloadImportAction {
  switch (code) {
    case PayloadErrorCode.ENVELOPE_VERIFICATION_ERROR:
    case PayloadErrorCode.INVALID_SIGNATURE:
      return {action: "rejected"};

    case PayloadErrorCode.EXECUTION_ENGINE_INVALID:
      return {action: "builderFault"};

    case PayloadErrorCode.BLOCK_NOT_IN_FORK_CHOICE:
      return {action: "park", reason: "awaitingBlock"};
    case PayloadErrorCode.MISS_BLOCK_STATE:
      return {action: "park", reason: "backoff"};
    case PayloadErrorCode.EXECUTION_ENGINE_ERROR:
      return {action: "park", reason: "elOffline"};

    default:
      throw new Error(`classifyPayloadImportError: unclassified code ${code satisfies never}`);
  }
}

/**
 * Reaction to a reqresp `RequestError` on any outbound fetch (walk hop,
 * envelope/column/block by-root).
 *
 * NONE of these score the peer (the never-report list: transport errors,
 * absence, partials, rate limits). Malformed-SSZ is deliberately included —
 * it is indistinguishable from a fork-schedule mismatch on our side.
 */
export type RequestFailureAction =
  /** Try the next eligible peer; the request itself is fine. */
  | {action: "rotate"}
  /** The remote rate-limited us — exclude this peer until its quota window resets. */
  | {action: "parkPeer"}
  /** We self-throttled — wait; no peer is at fault. */
  | {action: "selfThrottle"};

/**
 * Park `peer` if `e` says it is rate-limited, and report whether it did.
 *
 * The platform's authoritative backoff deadline dominates the static
 * classification: RESP_RATE_LIMITED always carries one, and
 * REQUEST_SELF_RATE_LIMITED carries one exactly when OUR limiter is backing
 * off because this peer rate-limited us earlier — in both cases the deadline
 * says precisely when the peer becomes usable again, so we park until THEN
 * instead of guessing a window. Without a deadline, a `parkPeer`
 * classification falls back to the ledger's default park duration.
 */
export function parkIfRateLimited(ledger: Pick<QuotaLedger, "parkPeer">, peer: PeerIdStr, e: RequestError): boolean {
  const type = e.type;
  const until =
    type.code === RequestErrorCode.RESP_RATE_LIMITED || type.code === RequestErrorCode.REQUEST_SELF_RATE_LIMITED
      ? type.rateLimitedUntilMs
      : undefined;
  if (until !== undefined) {
    ledger.parkPeer(peer, Math.max(0, until - Date.now()));
    return true;
  }
  if (classifyRequestError(type.code).action === "parkPeer") {
    ledger.parkPeer(peer);
    return true;
  }
  return false;
}

export function classifyRequestError(code: RequestErrorCode): RequestFailureAction {
  switch (code) {
    case RequestErrorCode.REQUEST_RATE_LIMITED:
    case RequestErrorCode.RESP_RATE_LIMITED:
      return {action: "parkPeer"};

    case RequestErrorCode.REQUEST_SELF_RATE_LIMITED:
      return {action: "selfThrottle"};

    case RequestErrorCode.INVALID_REQUEST:
    case RequestErrorCode.INVALID_RESPONSE_SSZ:
    case RequestErrorCode.SERVER_ERROR:
    case RequestErrorCode.RESOURCE_UNAVAILABLE:
    case RequestErrorCode.UNKNOWN_ERROR_STATUS:
    case RequestErrorCode.DIAL_TIMEOUT:
    case RequestErrorCode.DIAL_ERROR:
    case RequestErrorCode.REQUEST_TIMEOUT:
    case RequestErrorCode.REQUEST_ERROR:
    case RequestErrorCode.EMPTY_RESPONSE:
    case RequestErrorCode.RESP_TIMEOUT:
    case RequestErrorCode.SSZ_OVER_MAX_SIZE:
      return {action: "rotate"};

    default:
      throw new Error(`classifyRequestError: unclassified code ${code satisfies never}`);
  }
}
