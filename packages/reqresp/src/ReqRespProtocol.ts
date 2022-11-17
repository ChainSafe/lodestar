import {setMaxListeners} from "node:events";
import {Connection, Stream} from "@libp2p/interface-connection";
import {PeerId} from "@libp2p/interface-peer-id";
import {Libp2p} from "libp2p";
import {ILogger} from "@lodestar/utils";
import {IBeaconConfig} from "@lodestar/config";
import {Metrics} from "./metrics.js";
import {RequestError, RequestErrorCode, sendRequest} from "./request/index.js";
import {handleRequest} from "./response/index.js";
import {PeersData} from "./sharedTypes.js";
import {Encoding, Method, ProtocolDefinition, ReqRespOptions, RequestTypedContainer} from "./types.js";
import {formatProtocolID} from "./utils/index.js";
import {ReqRespHandlerProtocolContext} from "./interface.js";

type ProtocolID = string;

export interface ReqRespProtocolModules {
  libp2p: Libp2p;
  peersData: PeersData;
  logger: ILogger;
  config: IBeaconConfig;
  metrics: Metrics | null;
}

/**
 * Implementation of Ethereum Consensus p2p Req/Resp domain.
 * For the spec that this code is based on, see:
 * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/p2p-interface.md#the-reqresp-domain
 * https://github.com/ethereum/consensus-specs/blob/dev/specs/altair/light-client/p2p-interface.md#the-reqresp-domain
 */
export abstract class ReqRespProtocol<Context extends ReqRespHandlerProtocolContext = ReqRespHandlerProtocolContext> {
  private libp2p: Libp2p;
  private readonly peersData: PeersData;
  private logger: ILogger;
  private controller = new AbortController();
  private options: ReqRespOptions;
  private reqCount = 0;
  private respCount = 0;
  private metrics: Metrics | null;
  private config: IBeaconConfig;

  /** `${protocolPrefix}/${method}/${version}/${encoding}` */
  private readonly supportedProtocols = new Map<ProtocolID, ProtocolDefinition>();

  constructor(modules: ReqRespProtocolModules, options: ReqRespOptions) {
    this.options = options;
    this.config = modules.config;
    this.libp2p = modules.libp2p;
    this.peersData = modules.peersData;
    this.logger = modules.logger;
    this.metrics = modules.metrics;
  }

  registerProtocol<Req, Resp>(protocol: ProtocolDefinition<Req, Resp>): void {
    const {method, version, encoding} = protocol;
    const protocolID = formatProtocolID(method, version, encoding);
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
  protected async sendRequest<Req, Resp>(
    peerId: PeerId,
    method: string,
    versions: string[],
    body: Req,
    maxResponses = 1
  ): Promise<Resp> {
    const peerClient = this.peersData.getPeerKind(peerId.toString());
    this.metrics?.outgoingRequests.inc({method});
    const timer = this.metrics?.outgoingRequestRoundtripTime.startTimer({method});

    // Remember prefered encoding
    const encoding = this.peersData.getEncodingPreference(peerId.toString()) ?? Encoding.SSZ_SNAPPY;

    const protocols: ProtocolDefinition[] = [];
    for (const version of versions) {
      const protocolID = formatProtocolID(method, version, encoding);
      const protocol = this.supportedProtocols.get(protocolID);
      if (!protocol) {
        throw Error(`Request to send to protocol ${protocolID} but it has not been declared`);
      }
      protocols.push(protocol);
    }

    try {
      const result = await sendRequest<Req, Resp>(
        {logger: this.logger, libp2p: this.libp2p, peerClient},
        peerId,
        protocols,
        body,
        maxResponses,
        this.controller.signal,
        this.options,
        this.reqCount++
      );

      return result;
    } catch (e) {
      this.metrics?.outgoingErrors.inc({method});

      if (e instanceof RequestError) {
        if (e.type.code === RequestErrorCode.DIAL_ERROR || e.type.code === RequestErrorCode.DIAL_TIMEOUT) {
          this.metrics?.dialErrors.inc();
        }

        this.onOutgoingRequestError(peerId, method as Method, e);
      }

      throw e;
    } finally {
      timer?.();
    }
  }

  private getRequestHandler<Req, Resp>(protocol: ProtocolDefinition<Req, Resp>) {
    return async ({connection, stream}: {connection: Connection; stream: Stream}) => {
      const peerId = connection.remotePeer;
      const peerClient = this.peersData.getPeerKind(peerId.toString());
      const method = protocol.method;

      this.metrics?.incomingRequests.inc({method});
      const timer = this.metrics?.incomingRequestHandlerTime.startTimer({method});

      this.onIncomingRequest?.(peerId, method);

      try {
        await handleRequest<Req, Resp, Context>({
          context: this.getContext(),
          logger: this.logger,
          stream,
          peerId,
          protocol,
          signal: this.controller.signal,
          requestId: this.respCount++,
          peerClient,
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

  protected getContext(): Context {
    return {
      modules: {config: this.config, logger: this.logger, metrics: this.metrics, peersData: this.peersData},
      eventHandlers: {onIncomingRequestBody: this.onIncomingRequestBody},
    } as Context;
  }

  protected abstract onIncomingRequestBody(_req: RequestTypedContainer, _peerId: PeerId): void;
  protected abstract onOutgoingRequestError(_peerId: PeerId, _method: Method, _error: RequestError): void;
  protected abstract onIncomingRequest(_peerId: PeerId, _method: Method): void;
}
