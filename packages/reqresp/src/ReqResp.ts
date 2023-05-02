import {setMaxListeners} from "node:events";
import {Stream} from "@libp2p/interface-connection";
import {PeerId} from "@libp2p/interface-peer-id";
import {Logger} from "@lodestar/utils";
import {Metrics, MetricsRegister, getMetrics} from "./metrics.js";
import {ReqRespRateLimiter} from "./rate_limiter/ReqRespRateLimiter.js";
import {RequestError, RequestErrorCode, SendRequestOpts, sendRequest} from "./request/index.js";
import {handleRequest} from "./response/index.js";
import {DialOnlyProtocol, Encoding, MixedProtocol, Protocol, ReqRespRateLimiterOpts} from "./types.js";
import {formatProtocolID} from "./utils/protocolId.js";

type ProtocolID = string;

export const DEFAULT_PROTOCOL_PREFIX = "/eth2/beacon_chain/req";

export type ReqRespHandler = ({
  connection,
  stream,
}: {
  connection: {remotePeer: PeerId};
  stream: Stream;
}) => Promise<void>;

export interface ReqRespProtocolModules {
  logger: Logger;
  metricsRegister: MetricsRegister | null;
}

export interface ReqRespOpts extends SendRequestOpts, ReqRespRateLimiterOpts {
  /** Custom prefix for `/ProtocolPrefix/MessageName/SchemaVersion/Encoding` */
  protocolPrefix?: string;
  getPeerLogMetadata?: (peerId: string) => string;
}

export interface ReqRespRegisterOpts {
  ignoreIfDuplicate?: boolean;
}

/**
 * Implementation of Ethereum Consensus p2p Req/Resp domain.
 * For the spec that this code is based on, see:
 * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/p2p-interface.md#the-reqresp-domain
 * https://github.com/ethereum/consensus-specs/blob/dev/specs/altair/light-client/p2p-interface.md#the-reqresp-domain
 */
export abstract class ReqResp {
  protected readonly logger: Logger;
  protected readonly metrics: Metrics | null;

  // to not be used by extending class
  private readonly rateLimiter: ReqRespRateLimiter;
  private controller = new AbortController();
  /** Tracks request and responses in a sequential counter */
  private reqCount = 0;
  private readonly protocolPrefix: string;

  /** `${protocolPrefix}/${method}/${version}/${encoding}` */
  // Use any to avoid TS error on registering protocol
  // Type 'unknown' is not assignable to type 'Resp'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly registeredProtocols = new Map<ProtocolID, MixedProtocol<any, any>>();
  private readonly dialOnlyProtocols = new Map<ProtocolID, boolean>();

  constructor(modules: ReqRespProtocolModules, private readonly opts: ReqRespOpts = {}) {
    this.logger = modules.logger;
    this.metrics = modules.metricsRegister ? getMetrics(modules.metricsRegister) : null;
    this.protocolPrefix = opts.protocolPrefix ?? DEFAULT_PROTOCOL_PREFIX;
    this.rateLimiter = new ReqRespRateLimiter(opts);
  }

  /**
   * Register protocol which will be used only to dial to other peers
   * The libp2p instance will not handle that protocol
   *
   * Made it explicit method to avoid any developer mistake
   */
  registerDialOnlyProtocol<Req, Resp>(protocol: DialOnlyProtocol<Req, Resp>, opts?: ReqRespRegisterOpts): void {
    const protocolID = this.formatProtocolID(protocol);

    // libp2p will throw on error on duplicates, allow to overwrite behavior
    if (opts?.ignoreIfDuplicate && this.registeredProtocols.has(protocolID)) {
      return;
    }

    this.registeredProtocols.set(protocolID, protocol);
    this.dialOnlyProtocols.set(protocolID, true);
  }

  /**
   * Register protocol as supported and to libp2p.
   * async because libp2p registar persists the new protocol list in the peer-store.
   * Throws if the same protocol is registered twice.
   * Can be called at any time, no concept of started / stopped
   */
  async registerProtocol<Req, Resp>(protocol: Protocol<Req, Resp>, opts?: ReqRespRegisterOpts): Promise<void> {
    const protocolID = this.formatProtocolID(protocol);
    const {handler: _handler, renderRequestBody: _renderRequestBody, inboundRateLimits, ...rest} = protocol;
    this.registerDialOnlyProtocol(rest, opts);
    this.dialOnlyProtocols.set(protocolID, false);

    if (inboundRateLimits) {
      this.rateLimiter.initRateLimits(protocolID, inboundRateLimits);
    }

    this.onRegisterProtocol(protocolID, this.getRequestHandler(protocol, protocolID));
  }

  /**
   * Remove protocol as supported and from libp2p.
   * async because libp2p registar persists the new protocol list in the peer-store.
   * Does NOT throw if the protocolID is unknown.
   * Can be called at any time, no concept of started / stopped
   */
  async unregisterProtocol(protocolID: ProtocolID): Promise<void> {
    this.registeredProtocols.delete(protocolID);
    this.onUnregisterProtocol(protocolID);
  }

  /**
   * Remove all registered protocols from libp2p
   */
  async unregisterAllProtocols(): Promise<void> {
    for (const protocolID of this.registeredProtocols.keys()) {
      await this.unregisterProtocol(protocolID);
    }
  }

  getRegisteredProtocols(): ProtocolID[] {
    return Array.from(this.registeredProtocols.values()).map((protocol) => this.formatProtocolID(protocol));
  }

  async start(): Promise<void> {
    this.controller = new AbortController();
    this.rateLimiter.start();
    // We set infinity to prevent MaxListenersExceededWarning which get logged when listeners > 10
    // Since it is perfectly fine to have listeners > 10
    setMaxListeners(Infinity, this.controller.signal);
  }

  async stop(): Promise<void> {
    this.controller.abort();
  }

  // Helper to reduce code duplication
  protected async *sendRequest<Req, Resp>(
    peerId: PeerId,
    method: string,
    versions: number[],
    encoding: Encoding,
    body: Req
  ): AsyncIterable<Resp> {
    const peerClient = this.opts.getPeerLogMetadata?.(peerId.toString());
    this.metrics?.outgoingRequests.inc({method});
    const timer = this.metrics?.outgoingRequestRoundtripTime.startTimer({method});

    const protocols: (MixedProtocol | DialOnlyProtocol)[] = [];
    const protocolIDs: string[] = [];

    for (const version of versions) {
      const protocolID = this.formatProtocolID({method, version, encoding});
      const protocol = this.registeredProtocols.get(protocolID);
      if (!protocol) {
        throw Error(`Request to send to protocol ${protocolID} but it has not been declared`);
      }
      protocols.push(protocol);
      protocolIDs.push(protocolID);
    }

    try {
      yield* sendRequest<Req, Resp>(
        {logger: this.logger, streamGenerator: this.createStream, peerClient},
        peerId,
        protocols,
        protocolIDs,
        body,
        this.controller.signal,
        this.opts,
        this.reqCount++
      );
    } catch (e) {
      this.metrics?.outgoingErrors.inc({method});

      if (e instanceof RequestError) {
        if (e.type.code === RequestErrorCode.DIAL_ERROR || e.type.code === RequestErrorCode.DIAL_TIMEOUT) {
          this.metrics?.dialErrors.inc();
        }

        this.onOutgoingRequestError(peerId, method, e);
      }

      throw e;
    } finally {
      timer?.();
    }
  }

  private getRequestHandler<Req, Resp>(protocol: MixedProtocol<Req, Resp>, protocolID: string) {
    return async ({connection, stream}: {connection: {remotePeer: PeerId}; stream: Stream}) => {
      if (this.dialOnlyProtocols.get(protocolID)) {
        throw new Error(`Received request on dial only protocol '${protocolID}'`);
      }

      const peerId = connection.remotePeer;
      const peerClient = this.opts.getPeerLogMetadata?.(peerId.toString());
      const {method} = protocol;

      this.metrics?.incomingRequests.inc({method});
      const timer = this.metrics?.incomingRequestHandlerTime.startTimer({method});

      this.onIncomingRequest?.(peerId, protocol as MixedProtocol);

      try {
        await handleRequest<Req, Resp>({
          logger: this.logger,
          stream,
          peerId,
          protocol: protocol as Protocol<Req, Resp>,
          protocolID,
          rateLimiter: this.rateLimiter,
          signal: this.controller.signal,
          requestId: this.reqCount++,
          peerClient,
          requestTimeoutMs: this.opts.requestTimeoutMs,
        });
        // TODO: Do success peer scoring here
      } catch (err) {
        this.metrics?.incomingErrors.inc({method});

        if (err instanceof RequestError) {
          this.onIncomingRequestError(protocol, err);
        }

        // TODO: Do error peer scoring here
        // Must not throw since this is an event handler
      } finally {
        timer?.();
      }
    };
  }

  /**
   * ```
   * /ProtocolPrefix/MessageName/SchemaVersion/Encoding
   * ```
   * https://github.com/ethereum/consensus-specs/blob/v1.2.0/specs/phase0/p2p-interface.md#protocol-identification
   */
  protected formatProtocolID(protocol: Pick<MixedProtocol, "method" | "version" | "encoding">): string {
    return formatProtocolID(this.protocolPrefix, protocol.method, protocol.version, protocol.encoding);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected abstract onIncomingRequestError(_protocol: MixedProtocol<any, any>, _error: RequestError): void;
  protected abstract onOutgoingRequestError(_peerId: PeerId, _method: string, _error: RequestError): void;
  protected abstract onIncomingRequest(_peerId: PeerId, _protocol: MixedProtocol): void;
  protected abstract onRegisterProtocol(protocolId: ProtocolID, handler: ReqRespHandler): Promise<void>;
  protected abstract onUnregisterProtocol(protocolId: ProtocolID): Promise<void>;
  protected abstract createStream(opts: {peerId: PeerId; protocolIds: string[]; signal?: AbortSignal}): Promise<Stream>;
}
