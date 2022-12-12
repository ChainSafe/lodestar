import {PeerId} from "@libp2p/interface-peer-id";
import {ILogger} from "@lodestar/utils";
import {Metrics} from "../metrics.js";
import {RequestError, RequestErrorCode} from "../request/errors.js";
import {ProtocolDefinition, ReqRespRateLimiterModules, ReqRespRateLimiterOpts} from "../types.js";
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
  private readonly metrics: Metrics | null;
  private readonly logger: ILogger;
  private readonly reportPeer: ReqRespRateLimiterModules["reportPeer"];

  constructor({metrics, logger, reportPeer}: ReqRespRateLimiterModules, {rateLimitMultiplier}: ReqRespRateLimiterOpts) {
    this.metrics = metrics;
    this.reportPeer = reportPeer;
    this.logger = logger;
    this.rateLimitMultiplier = rateLimitMultiplier ?? 1;
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
    const limiterByPeer = RateLimiterGRCA.fromQuota<string>({
      ...protocol.inboundRateLimits.byPeer,
      quota: protocol.inboundRateLimits.byPeer.quota * this.rateLimitMultiplier,
    });
    const limiterTotal = RateLimiterGRCA.fromQuota<null>({
      ...protocol.inboundRateLimits.total,
      quota: protocol.inboundRateLimits.total.quota * this.rateLimitMultiplier,
    });

    if (!this.rateLimitersPerPeer.has(method)) {
      this.rateLimitersPerPeer.set(method, new Map());
    }

    if (!this.rateLimitersTotal.has(method)) {
      this.rateLimitersTotal.set(method, new Map());
    }

    this.rateLimitersPerPeer.get(method)?.set(version, limiterByPeer);
    this.rateLimitersTotal.get(method)?.set(version, limiterTotal);
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
    const {method, version, encoding} = protocol;
    const requestCount = protocol.inboundRateLimits.getRequestCount
      ? protocol.inboundRateLimits.getRequestCount(requestBody)
      : 1;

    if (!this.rateLimitersPerPeer.get(method)?.get(version)?.allows(peerIdStr, requestCount)) {
      this.logger.debug("Do not serve request due to rate limit", {
        peerId: peerIdStr,
      });

      this.reportPeer(peerId);

      if (this.metrics) {
        this.metrics.rateLimitErrors.inc({method: protocol.method});
      }

      throw new RequestError({code: RequestErrorCode.REQUEST_RATE_LIMITED}, {peer: peerIdStr, method, encoding});
    }

    if (!this.rateLimitersTotal.get(method)?.get(version)?.allows(null, requestCount)) {
      this.logger.debug("Do not serve request due to total rate limit", {
        peerId: peerIdStr,
      });

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
