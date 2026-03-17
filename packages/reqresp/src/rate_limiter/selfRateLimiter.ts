import {MAX_CONCURRENT_REQUESTS} from "@lodestar/params";
import {Logger, MapDef} from "@lodestar/utils";

type PeerIdStr = string;
type ProtocolID = string;

/** Sometimes a peer request comes AFTER libp2p disconnect event, check for such peers every 2 minutes */
export const CHECK_DISCONNECTED_PEERS_INTERVAL_MS = 2 * 60 * 1000;

/** Given PING_INTERVAL constants of 15s/20s, we consider a peer is disconnected if there is no request in 1 minute */
const DISCONNECTED_TIMEOUT_MS = 60 * 1000;

/**
 * Timeout to consider a request is no longer in progress
 * this is to cover the case where `requestCompleted()` is not called due to unexpected errors
 * for example https://github.com/ChainSafe/lodestar/issues/8256
 **/
export const REQUEST_TIMEOUT_MS = 30 * 1000;

/**
 * Default backoff when a peer rate limits us without specifying a duration.
 * Only Grandine sends an explicit backoff (parsed and used directly); all other clients
 * send static error messages and fall back to this value.
 *
 * Cross-client rate limit behavior (as of March 2026):
 *   - Lighthouse: concurrent-limit only (max 2 in-flight per protocol), no GCRA rejections
 *   - Prysm:      30s leaky bucket for blocks/blobs, 1s for individual RPCs
 *   - Teku:       60s sliding window — then disconnects the peer entirely
 *   - Nimbus:     silent throttling (never sends errors)
 *   - Grandine:   GCRA with explicit wait time — this default is not used
 *
 * 5s is a circuit breaker, not a full recovery wait. It prevents immediate retry loops
 * while staying well under the ping interval (15-20s) since the backoff blocks ALL
 * protocols for the peer. For Lighthouse/Grandine's concurrent limit, 5s is enough for
 * an in-flight request to complete and free a slot (typical RTT 1-3s). For Prysm's
 * longer bucket, repeated rate limits naturally extend the backoff window.
 */
export const DEFAULT_RATE_LIMIT_BACKOFF_MS = 5_000;

/** Maximum backoff to prevent a malicious peer from requesting an excessively long backoff */
export const MAX_RATE_LIMIT_BACKOFF_MS = 60_000;

type RequestId = number;
type RequestIdMs = number;

/**
 * Simple rate limiter that allows a maximum of 2 concurrent requests per protocol per peer.
 * Also tracks when a peer has rate-limited us and enforces a backoff period before allowing new requests.
 * The consumer should either prevent requests from being sent when the limit is reached or handle the case when the request is not allowed.
 *
 * Note: SyncChain maintains its own rate-limit backoff map to avoid assigning batches to backed-off
 * peers. This class acts as the authoritative safety net at the protocol level.
 */
export class SelfRateLimiter {
  private readonly rateLimitersPerPeer: MapDef<PeerIdStr, MapDef<ProtocolID, Map<RequestId, RequestIdMs>>>;
  /**
   * It's not convenient to handle a peer disconnected event so we track the last seen requests by peer.
   * This is the same design to `ReqRespRateLimiter`.
   **/
  private lastSeenRequestsByPeer: Map<string, number>;
  /** Tracks the timestamp (ms) until which we should not send requests to a peer */
  private rateLimitedUntilByPeer: Map<PeerIdStr, number>;
  /** Interval to check lastSeenMessagesByPeer */
  private cleanupInterval: NodeJS.Timeout | undefined = undefined;

  constructor(private readonly logger?: Logger) {
    this.rateLimitersPerPeer = new MapDef<PeerIdStr, MapDef<ProtocolID, Map<RequestId, RequestIdMs>>>(
      () => new MapDef<ProtocolID, Map<RequestId, RequestIdMs>>(() => new Map())
    );
    this.lastSeenRequestsByPeer = new Map();
    this.rateLimitedUntilByPeer = new Map();
  }

  start(): void {
    this.cleanupInterval = setInterval(this.checkDisconnectedPeers.bind(this), CHECK_DISCONNECTED_PEERS_INTERVAL_MS);
  }

  stop(): void {
    if (this.cleanupInterval !== undefined) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }

  /**
   * called before we send a request to a peer.
   */
  allows(peerId: PeerIdStr, protocolId: ProtocolID, requestId: RequestId): boolean {
    const now = Date.now();

    // Check if peer has rate-limited us and we're still in backoff
    const rateLimitedUntil = this.rateLimitedUntilByPeer.get(peerId);
    if (rateLimitedUntil !== undefined) {
      if (now < rateLimitedUntil) {
        // Keep peer alive so checkDisconnectedPeers() doesn't prematurely evict the backoff entry
        this.lastSeenRequestsByPeer.set(peerId, now);
        return false;
      }
      // Backoff expired, clean up
      this.rateLimitedUntilByPeer.delete(peerId);
    }

    const peerRateLimiter = this.rateLimitersPerPeer.getOrDefault(peerId);
    const trackedRequests = peerRateLimiter.getOrDefault(protocolId);
    this.lastSeenRequestsByPeer.set(peerId, now);

    let inProgressRequests = 0;
    for (const [trackedRequestId, trackedRequestTimeMs] of trackedRequests.entries()) {
      if (trackedRequestTimeMs + REQUEST_TIMEOUT_MS <= now) {
        // request timed out, remove it
        trackedRequests.delete(trackedRequestId);
        this.logger?.debug("SelfRateLimiter: request timed out, removing it", {
          requestId: trackedRequestId,
          requestTime: trackedRequestTimeMs,
          peerId,
          protocolId,
        });
      } else {
        inProgressRequests++;
      }
    }

    if (inProgressRequests >= MAX_CONCURRENT_REQUESTS) {
      return false;
    }

    trackedRequests.set(requestId, now);
    return true;
  }

  /**
   * called when a request to a peer is completed, regardless of success or failure.
   * This should NOT be called when the request was not allowed
   */
  requestCompleted(peerId: PeerIdStr, protocolId: ProtocolID, requestId: RequestId): void {
    const peerRateLimiter = this.rateLimitersPerPeer.getOrDefault(peerId);
    const trackedRequests = peerRateLimiter.getOrDefault(protocolId);
    trackedRequests.delete(requestId);
  }

  /**
   * Called when a peer responds with a rate-limit error, to enforce a backoff period before retrying.
   */
  onRateLimited(peerId: PeerIdStr, backoffMs = DEFAULT_RATE_LIMIT_BACKOFF_MS): void {
    const cappedBackoffMs = Math.min(backoffMs, MAX_RATE_LIMIT_BACKOFF_MS);
    const rateLimitedUntil = Date.now() + cappedBackoffMs;
    this.rateLimitedUntilByPeer.set(peerId, rateLimitedUntil);
    this.logger?.debug("SelfRateLimiter: peer rate limited us, backing off", {peerId, backoffMs: cappedBackoffMs});
  }

  getPeerCount(): number {
    return this.rateLimitersPerPeer.size;
  }

  getRateLimitedPeerCount(): number {
    return this.rateLimitedUntilByPeer.size;
  }

  private checkDisconnectedPeers(): void {
    const now = Date.now();
    for (const [peerIdStr, lastSeenTime] of this.lastSeenRequestsByPeer.entries()) {
      if (now - lastSeenTime >= DISCONNECTED_TIMEOUT_MS) {
        this.rateLimitersPerPeer.delete(peerIdStr);
        this.lastSeenRequestsByPeer.delete(peerIdStr);
        this.rateLimitedUntilByPeer.delete(peerIdStr);
      }
    }
    // Also clean up expired backoff entries for peers still connected
    for (const [peerIdStr, rateLimitedUntil] of this.rateLimitedUntilByPeer.entries()) {
      if (now >= rateLimitedUntil) {
        this.rateLimitedUntilByPeer.delete(peerIdStr);
      }
    }
  }
}
