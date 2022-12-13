import {PeerId} from "@libp2p/interface-peer-id";
import {InboundRateLimitQuota, ReqRespRateLimiterOpts} from "../types.js";
import {RateLimiterGRCA} from "./rateLimiterGRCA.js";

/** Sometimes a peer request comes AFTER libp2p disconnect event, check for such peers every 10 minutes */
const CHECK_DISCONNECTED_PEERS_INTERVAL_MS = 10 * 60 * 1000;

/** Peers don't request us for 5 mins are considered disconnected */
const DISCONNECTED_TIMEOUT_MS = 5 * 60 * 1000;

type ProtocolID = string;

export class ReqRespRateLimiter {
  private readonly rateLimitersPerPeer = new Map<ProtocolID, RateLimiterGRCA<string>>();
  private readonly rateLimitersTotal = new Map<ProtocolID, RateLimiterGRCA<null>>();
  /** Interval to check lastSeenMessagesByPeer */
  private cleanupInterval: NodeJS.Timeout | undefined = undefined;
  private rateLimitMultiplier: number;
  /** Periodically check this to remove tracker of disconnected peers */
  private lastSeenRequestsByPeer: Map<string, number>;

  constructor(private readonly opts?: ReqRespRateLimiterOpts) {
    this.rateLimitMultiplier = opts?.rateLimitMultiplier ?? 1;
    this.lastSeenRequestsByPeer = new Map();
  }

  get enabled(): boolean {
    return this.rateLimitMultiplier > 0;
  }

  initRateLimits<Req>(protocolID: ProtocolID, rateLimits: InboundRateLimitQuota<Req>): void {
    if (!this.enabled) {
      return;
    }

    if (rateLimits.byPeer) {
      this.rateLimitersPerPeer.set(
        protocolID,
        RateLimiterGRCA.fromQuota<string>({
          quotaTimeMs: rateLimits.byPeer.quotaTimeMs,
          quota: rateLimits.byPeer.quota * this.rateLimitMultiplier,
        })
      );
    }

    if (rateLimits.total) {
      this.rateLimitersTotal.set(
        protocolID,
        RateLimiterGRCA.fromQuota<null>({
          quotaTimeMs: rateLimits.total.quotaTimeMs,
          quota: rateLimits.total.quota * this.rateLimitMultiplier,
        })
      );
    }
  }

  allows(peerId: PeerId, protocolID: string, requestCount: number): boolean {
    if (!this.enabled) {
      return true;
    }

    const peerIdStr = peerId.toString();
    this.lastSeenRequestsByPeer.set(peerIdStr, Date.now());

    const byPeer = this.rateLimitersPerPeer.get(protocolID);
    const total = this.rateLimitersTotal.get(protocolID);

    if ((byPeer && !byPeer.allows(peerIdStr, requestCount)) || (total && !total.allows(null, requestCount))) {
      this.opts?.onRateLimit?.(peerId, protocolID);
      return false;
    } else {
      return true;
    }
  }

  prune(peerId: PeerId): void {
    const peerIdStr = peerId.toString();
    this.pruneByPeerIdStr(peerIdStr);
  }

  start(): void {
    this.cleanupInterval = setInterval(this.checkDisconnectedPeers.bind(this), CHECK_DISCONNECTED_PEERS_INTERVAL_MS);
  }

  stop(): void {
    if (this.cleanupInterval !== undefined) {
      clearInterval(this.cleanupInterval);
    }
  }

  private pruneByPeerIdStr(peerIdStr: string): void {
    // Check for every method and version to cleanup
    for (const method of this.rateLimitersPerPeer.values()) {
      method.pruneByKey(peerIdStr);
    }
    this.lastSeenRequestsByPeer.delete(peerIdStr);
  }

  private checkDisconnectedPeers(): void {
    const now = Date.now();
    for (const [peerIdStr, lastSeenTime] of this.lastSeenRequestsByPeer.entries()) {
      if (now - lastSeenTime >= DISCONNECTED_TIMEOUT_MS) {
        this.pruneByPeerIdStr(peerIdStr);
      }
    }
  }
}
