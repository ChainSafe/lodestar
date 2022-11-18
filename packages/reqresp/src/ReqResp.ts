import {setMaxListeners} from "node:events";
import {Connection, Stream} from "@libp2p/interface-connection";
import {PeerId} from "@libp2p/interface-peer-id";
import {Libp2p} from "libp2p";
import {ILogger} from "@lodestar/utils";
import {IBeaconConfig} from "@lodestar/config";
import {getMetrics, Metrics, MetricsRegister} from "./metrics.js";
import {RequestError, RequestErrorCode, sendRequest, SendRequestOpts} from "./request/index.js";
import {handleRequest} from "./response/index.js";
import {Encoding, ProtocolDefinition} from "./types.js";

type ProtocolID = string;

export const DEFAULT_PROTOCOL_PREFIX = "/eth2/beacon_chain/req";

export interface ReqRespProtocolModules {
  libp2p: Libp2p;
  logger: ILogger;
  config: IBeaconConfig;
  metrics: Metrics | null;
}

export interface ReqRespOpts extends SendRequestOpts {
  /** Custom prefix for `/ProtocolPrefix/MessageName/SchemaVersion/Encoding` */
  protocolPrefix?: string;
  getPeerLogMetadata?: (peerId: string) => string;
}

/**
 * Implementation of Ethereum Consensus p2p Req/Resp domain.
 * For the spec that this code is based on, see:
 * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/p2p-interface.md#the-reqresp-domain
 * https://github.com/ethereum/consensus-specs/blob/dev/specs/altair/light-client/p2p-interface.md#the-reqresp-domain
 */
export abstract class ReqResp {
  private readonly libp2p: Libp2p;
  private readonly logger: ILogger;
  private readonly metrics: Metrics | null;
  private controller = new AbortController();
  /** Tracks request and responses in a sequential counter */
  private reqCount = 0;
  private readonly protocolPrefix: string;

  /** `${protocolPrefix}/${method}/${version}/${encoding}` */
  private readonly supportedProtocols = new Map<ProtocolID, ProtocolDefinition>();

  constructor(modules: ReqRespProtocolModules, private readonly opts: ReqRespOpts) {
    this.libp2p = modules.libp2p;
    this.logger = modules.logger;
    this.metrics = modules.metrics ? getMetrics((modules.metrics as unknown) as MetricsRegister) : null;
    this.protocolPrefix = opts.protocolPrefix ?? DEFAULT_PROTOCOL_PREFIX;
  }

  registerProtocol<Req, Resp>(protocol: ProtocolDefinition<Req, Resp>): void {
    const {method, version, encoding} = protocol;
    const protocolID = this.formatProtocolID(method, version, encoding);
    this.supportedProtocols.set(protocolID, protocol as ProtocolDefinition);
  }

  async start(): Promise<void> {
    this.controller = new AbortController();
    // We set infinity to prevent MaxListenersExceededWarning which get logged when listeners > 10
    // Since it is perfectly fine to have listeners > 10
    setMaxListeners(Infinity, this.controller.signal);

    for (const [protocolID, protocol] of this.supportedProtocols) {
      await this.libp2p.handle(protocolID, this.getRequestHandler(protocol));
    }
  }

  async stop(): Promise<void> {
    for (const protocolID of this.supportedProtocols.keys()) {
      await this.libp2p.unhandle(protocolID);
    }
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
      const protocolID = this.formatProtocolID(method, version, encoding);
      const protocol = this.supportedProtocols.get(protocolID);
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

  private getRequestHandler<Req, Resp>(protocol: ProtocolDefinition<Req, Resp>) {
    return async ({connection, stream}: {connection: Connection; stream: Stream}) => {
      const peerId = connection.remotePeer;
      const peerClient = this.opts.getPeerLogMetadata?.(peerId.toString());
      const method = protocol.method;

      this.metrics?.incomingRequests.inc({method});
      const timer = this.metrics?.incomingRequestHandlerTime.startTimer({method});

      this.onIncomingRequest?.(peerId, method);

      try {
        await handleRequest<Req, Resp>({
          logger: this.logger,
          stream,
          peerId,
          protocol,
          signal: this.controller.signal,
          requestId: this.reqCount++,
          peerClient,
          requestTimeoutMs: this.opts.requestTimeoutMs,
        });
        // TODO: Do success peer scoring here
      } catch {
        this.metrics?.incomingErrors.inc({method});

        // TODO: Do error peer scoring here
        // Must not throw since this is an event handler
      } finally {
        timer?.();
      }
    };
  }

  protected onIncomingRequest(_peerId: PeerId, _method: string): void {
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
  protected formatProtocolID(method: string, version: number, encoding: Encoding): string {
    return `${this.protocolPrefix}/${method}/${version}/${encoding}`;
  }
}
