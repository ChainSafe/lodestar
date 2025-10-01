import {Logger, MapDef} from "@lodestar/utils";

type PeerIdStr = string;
type ProtocolID = string;
/** https://github.com/ethereum/consensus-specs/blob/master/specs/phase0/p2p-interface.md#constants */
const MAX_CONCURRENT_REQUESTS = 2;

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

type RequestId = number;
type RequestIdMs = number;

/**
 * Simple rate limiter that allows a maximum of 2 concurrent requests per protocol per peer.
 * The consumer should either prevent requests from being sent when the limit is reached or handle the case when the request is not allowed.
 */
export class SelfRateLimiter {
  private readonly rateLimitersPerPeer: MapDef<PeerIdStr, MapDef<ProtocolID, Map<RequestId, RequestIdMs>>>;
  /**
   * It's not convenient to handle a peer disconnected event so we track the last seen requests by peer.
   * This is the same design to `ReqRespRateLimiter`.
   **/
  private lastSeenRequestsByPeer: Map<string, number>;
  /** Interval to check lastSeenMessagesByPeer */
  private cleanupInterval: NodeJS.Timeout | undefined = undefined;

  constructor(private readonly logger?: Logger) {
    this.rateLimitersPerPeer = new MapDef<PeerIdStr, MapDef<ProtocolID, Map<RequestId, RequestIdMs>>>(
      () => new MapDef<ProtocolID, Map<RequestId, RequestIdMs>>(() => new Map())
    );
    this.lastSeenRequestsByPeer = new Map();
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

  getPeerCount(): number {
    return this.rateLimitersPerPeer.size;
  }

  private checkDisconnectedPeers(): void {
    const now = Date.now();
    for (const [peerIdStr, lastSeenTime] of this.lastSeenRequestsByPeer.entries()) {
      if (now - lastSeenTime >= DISCONNECTED_TIMEOUT_MS) {
        this.rateLimitersPerPeer.delete(peerIdStr);
        this.lastSeenRequestsByPeer.delete(peerIdStr);
      }
    }
  }
}
