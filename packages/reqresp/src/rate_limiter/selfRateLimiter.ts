import {MapDef} from "@lodestar/utils";

type PeerIdStr = string;
type ProtocolID = string;
/** https://github.com/ethereum/consensus-specs/blob/master/specs/phase0/p2p-interface.md#constants */
const MAX_CONCURRENT_REQUESTS = 2;

/** Sometimes a peer request comes AFTER libp2p disconnect event, check for such peers every 2 minutes */
export const CHECK_DISCONNECTED_PEERS_INTERVAL_MS = 2 * 60 * 1000;

/** Given PING_INTERVAL constants of 15s/20s, we consider a peer is disconnected if there is no request in 1 minute */
const DISCONNECTED_TIMEOUT_MS = 60 * 1000;

/**
 * Simple rate limiter that allows a maximum of 2 concurrent requests per protocol per peer.
 * The consumer should either prevent requests from being sent when the limit is reached or handle the case when the request is not allowed.
 */
export class SelfRateLimiter {
  private readonly rateLimitersPerPeer: MapDef<PeerIdStr, MapDef<ProtocolID, number>>;
  /**
   * It's not convenient to handle a peer disconnected event so we track the last seen requests by peer.
   * This is the same design to `ReqRespRateLimiter`.
   **/
  private lastSeenRequestsByPeer: Map<string, number>;
  /** Interval to check lastSeenMessagesByPeer */
  private cleanupInterval: NodeJS.Timeout | undefined = undefined;

  constructor() {
    this.rateLimitersPerPeer = new MapDef<PeerIdStr, MapDef<ProtocolID, number>>(
      () => new MapDef<ProtocolID, number>(() => 0)
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
  allows(peerId: PeerIdStr, protocolId: ProtocolID): boolean {
    const peerRateLimiter = this.rateLimitersPerPeer.getOrDefault(peerId);
    const inProgressRequests = peerRateLimiter.getOrDefault(protocolId);
    this.lastSeenRequestsByPeer.set(peerId, Date.now());
    if (inProgressRequests >= MAX_CONCURRENT_REQUESTS) {
      return false;
    }

    peerRateLimiter.set(protocolId, inProgressRequests + 1);
    return true;
  }

  /**
   * called when a request to a peer is completed, regardless of success or failure.
   * This should NOT be called when the request was not allowed
   */
  requestCompleted(peerId: PeerIdStr, protocolId: ProtocolID): void {
    const peerRateLimiter = this.rateLimitersPerPeer.getOrDefault(peerId);
    const inProgressRequests = peerRateLimiter.getOrDefault(protocolId);
    peerRateLimiter.set(protocolId, Math.max(0, inProgressRequests - 1));
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
