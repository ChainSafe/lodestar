import {setMaxListeners} from "node:events";
import {Connection, Stream} from "@libp2p/interface-connection";
import {PeerId} from "@libp2p/interface-peer-id";
import {Libp2p} from "libp2p";
import {Logger} from "@lodestar/utils";
import {getMetrics, Metrics, MetricsRegister} from "./metrics.js";
import {RequestError, RequestErrorCode, sendRequest, SendRequestOpts} from "./request/index.js";
import {handleRequest} from "./response/index.js";
import {Encoding, ProtocolDefinition, ReqRespRateLimiterOpts} from "./types.js";
import {formatProtocolID} from "./utils/protocolId.js";
import {ReqRespRateLimiter} from "./rate_limiter/ReqRespRateLimiter.js";

type ProtocolID = string;

export const DEFAULT_PROTOCOL_PREFIX = "/eth2/beacon_chain/req";

export interface ReqRespProtocolModules {
  libp2p: Libp2p;
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
export class ReqResp {
  // protected to be usable by extending class
  protected readonly libp2p: Libp2p;
  protected readonly logger: Logger;
  protected readonly metrics: Metrics | null;

  // to not be used by extending class
  private readonly rateLimiter: ReqRespRateLimiter;
  private controller = new AbortController();
  /** Tracks request and responses in a sequential counter */
  private reqCount = 0;
  private readonly protocolPrefix: string;

  /** `${protocolPrefix}/${method}/${version}/${encoding}` */
  private readonly registeredProtocols = new Map<ProtocolID, ProtocolDefinition>();

  constructor(modules: ReqRespProtocolModules, private readonly opts: ReqRespOpts = {}) {
    this.libp2p = modules.libp2p;
    this.logger = modules.logger;
    this.metrics = modules.metricsRegister ? getMetrics(modules.metricsRegister) : null;
    this.protocolPrefix = opts.protocolPrefix ?? DEFAULT_PROTOCOL_PREFIX;
    this.rateLimiter = new ReqRespRateLimiter(opts);
  }

  /**
   * Register protocol as supported and to libp2p.
   * async because libp2p registar persists the new protocol list in the peer-store.
   * Throws if the same protocol is registered twice.
   * Can be called at any time, no concept of started / stopped
   */
  async registerProtocol<Req, Resp>(
    protocol: ProtocolDefinition<Req, Resp>,
    opts?: ReqRespRegisterOpts
  ): Promise<void> {
    const protocolID = this.formatProtocolID(protocol);

    // libp2p will throw on error on duplicates, allow to overwrite behaviour
    if (opts?.ignoreIfDuplicate && this.registeredProtocols.has(protocolID)) {
      return;
    }

    this.registeredProtocols.set(protocolID, protocol as ProtocolDefinition);

    if (protocol.inboundRateLimits) {
      this.rateLimiter.initRateLimits(protocolID, protocol.inboundRateLimits);
    }

    return this.libp2p.handle(protocolID, this.getRequestHandler(protocol, protocolID));
  }

  /**
   * Remove protocol as supported and from libp2p.
   * async because libp2p registar persists the new protocol list in the peer-store.
   * Does NOT throw if the protocolID is unknown.
   * Can be called at any time, no concept of started / stopped
   */
  async unregisterProtocol(protocolID: ProtocolID): Promise<void> {
    this.registeredProtocols.delete(protocolID);

    return this.libp2p.unhandle(protocolID);
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

    const protocols: ProtocolDefinition[] = [];
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
        {logger: this.logger, libp2p: this.libp2p, peerClient},
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

  private getRequestHandler<Req, Resp>(protocol: ProtocolDefinition<Req, Resp>, protocolID: string) {
    return async ({connection, stream}: {connection: Connection; stream: Stream}) => {
      const peerId = connection.remotePeer;
      const peerClient = this.opts.getPeerLogMetadata?.(peerId.toString());
      const {method} = protocol;

      this.metrics?.incomingRequests.inc({method});
      const timer = this.metrics?.incomingRequestHandlerTime.startTimer({method});

      this.onIncomingRequest?.(peerId, protocol as ProtocolDefinition);

      try {
        await handleRequest<Req, Resp>({
          logger: this.logger,
          stream,
          peerId,
          protocol,
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

  protected onIncomingRequest(_peerId: PeerId, _protocol: ProtocolDefinition): void {
    // Override
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected onIncomingRequestError(_protocol: ProtocolDefinition<any, any>, _error: RequestError): void {
    // Override
  }

  protected onOutgoingRequestError(_peerId: PeerId, _method: string, _error: RequestError): void {
    // Override
  }

  /**
   * ```
   * /ProtocolPrefix/MessageName/SchemaVersion/Encoding
   * ```
   * https://github.com/ethereum/consensus-specs/blob/v1.2.0/specs/phase0/p2p-interface.md#protocol-identification
   */
  protected formatProtocolID(protocol: Pick<ProtocolDefinition, "method" | "version" | "encoding">): string {
    return formatProtocolID(this.protocolPrefix, protocol.method, protocol.version, protocol.encoding);
  }
}
