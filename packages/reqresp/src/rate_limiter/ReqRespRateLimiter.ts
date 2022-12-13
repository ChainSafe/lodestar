import {PeerId} from "@libp2p/interface-peer-id";
import {RequestError, RequestErrorCode} from "../request/errors.js";
import {ProtocolDefinition, ReqRespRateLimiterOpts} from "../types.js";
import {RateLimiterGRCA} from "./rateLimiterGRCA.js";

/** Sometimes a peer request comes AFTER libp2p disconnect event, check for such peers every 10 minutes */
const CHECK_DISCONNECTED_PEERS_INTERVAL_MS = 10 * 60 * 1000;

/** Peers don't request us for 5 mins are considered disconnected */
const DISCONNECTED_TIMEOUT_MS = 5 * 60 * 1000;

type ProtocolMethod = string;
type ProtocolVersion = number;

export class ReqRespRateLimiter {
  private readonly rateLimitersPerPeer = new Map<ProtocolMethod, Map<ProtocolVersion, RateLimiterGRCA<string>>>();
  private readonly rateLimitersTotal = new Map<ProtocolMethod, Map<ProtocolVersion, RateLimiterGRCA<null>>>();
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

  initRateLimits<Req, Resp>(protocol: ProtocolDefinition<Req, Resp>): void {
    if (!this.enabled) {
      return;
    }

    const {method, version} = protocol;

    if (protocol.inboundRateLimits.byPeer) {
      const limiterByPeer = RateLimiterGRCA.fromQuota<string>({
        ...protocol.inboundRateLimits.byPeer,
        quota: protocol.inboundRateLimits.byPeer.quota * this.rateLimitMultiplier,
      });

      if (!this.rateLimitersPerPeer.has(method)) {
        this.rateLimitersPerPeer.set(method, new Map());
      }

      this.rateLimitersPerPeer.get(method)?.set(version, limiterByPeer);
    }

    if (protocol.inboundRateLimits.total) {
      const limiterTotal = RateLimiterGRCA.fromQuota<null>({
        ...protocol.inboundRateLimits.total,
        quota: protocol.inboundRateLimits.total.quota * this.rateLimitMultiplier,
      });

      if (!this.rateLimitersTotal.has(method)) {
        this.rateLimitersTotal.set(method, new Map());
      }

      this.rateLimitersTotal.get(method)?.set(version, limiterTotal);
    }
  }

  validateRateLimits<Req, Resp>({
    peerId,
    protocol,
    requestBody,
  }: {
    peerId: PeerId;
    protocol: ProtocolDefinition<Req, Resp>;
    requestBody: Req;
  }): void {
    if (!this.enabled) {
      return;
    }

    const peerIdStr = peerId.toString();
    this.lastSeenRequestsByPeer.set(peerIdStr, Date.now());

    const {method, encoding} = protocol;

    const requestCount = protocol.inboundRateLimits.getRequestCount
      ? protocol.inboundRateLimits.getRequestCount(requestBody)
      : 1;

    const byPeer = this.rateLimitersPerPeer.get(protocol.method)?.get(protocol.version);
    const total = this.rateLimitersTotal.get(protocol.method)?.get(protocol.version);

    if ((byPeer && !byPeer.allows(peerIdStr, requestCount)) || (total && !total.allows(null, requestCount))) {
      this.opts?.onRateLimit?.(peerId, method);

      throw new RequestError({code: RequestErrorCode.REQUEST_RATE_LIMITED}, {peer: peerIdStr, method, encoding});
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
      for (const version of method.values()) {
        version.pruneByKey(peerIdStr);
      }
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
