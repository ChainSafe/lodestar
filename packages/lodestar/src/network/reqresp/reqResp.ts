/**
 * @module network
 */
import {Connection} from "libp2p";
import {HandlerProps} from "libp2p/src/registrar";
import {ForkName} from "@chainsafe/lodestar-params";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {allForks, phase0} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {AbortController} from "@chainsafe/abort-controller";
import LibP2p from "libp2p";
import PeerId from "peer-id";
import {RespStatus, timeoutOptions} from "../../constants";
import {IReqResp, IReqRespModules, IRateLimiter, Libp2pStream} from "./interface";
import {sendRequest} from "./request";
import {handleRequest, ResponseError} from "./response";
import {onOutgoingReqRespError} from "./score";
import {IPeerMetadataStore, IPeerRpcScoreStore} from "../peers";
import {assertSequentialBlocksInRange, formatProtocolId} from "./utils";
import {MetadataController} from "../metadata";
import {INetworkEventBus, NetworkEvent} from "../events";
import {ReqRespHandlers} from "./handlers";
import {IMetrics} from "../../metrics";
import {RequestError, RequestErrorCode} from "./request";
import {
  Method,
  Version,
  Encoding,
  Protocol,
  OutgoingResponseBody,
  RequestBody,
  RequestTypedContainer,
  protocolsSupported,
  IncomingResponseBody,
} from "./types";
import {InboundRateLimiter, RateLimiterOpts} from "./response/rateLimiter";

export type IReqRespOptions = Partial<typeof timeoutOptions>;

/**
 * Implementation of eth2 p2p Req/Resp domain.
 * For the spec that this code is based on, see:
 * https://github.com/ethereum/eth2.0-specs/blob/dev/specs/phase0/p2p-interface.md#the-reqresp-domain
 */
export class ReqResp implements IReqResp {
  private config: IBeaconConfig;
  private libp2p: LibP2p;
  private logger: ILogger;
  private reqRespHandlers: ReqRespHandlers;
  private metadataController: MetadataController;
  private peerMetadata: IPeerMetadataStore;
  private peerRpcScores: IPeerRpcScoreStore;
  private inboundRateLimiter: IRateLimiter;
  private networkEventBus: INetworkEventBus;
  private controller = new AbortController();
  private options?: IReqRespOptions;
  private reqCount = 0;
  private respCount = 0;
  private metrics: IMetrics | null;

  constructor(modules: IReqRespModules, options: IReqRespOptions & RateLimiterOpts) {
    this.config = modules.config;
    this.libp2p = modules.libp2p;
    this.logger = modules.logger;
    this.reqRespHandlers = modules.reqRespHandlers;
    this.peerMetadata = modules.peerMetadata;
    this.metadataController = modules.metadata;
    this.peerRpcScores = modules.peerRpcScores;
    this.inboundRateLimiter = new InboundRateLimiter(options, {...modules});
    this.networkEventBus = modules.networkEventBus;
    this.options = options;
    this.metrics = modules.metrics;
  }

  start(): void {
    this.controller = new AbortController();
    for (const [method, version, encoding] of protocolsSupported) {
      this.libp2p.handle(
        formatProtocolId(method, version, encoding),
        (this.getRequestHandler({method, version, encoding}) as unknown) as (props: HandlerProps) => void
      );
    }
    this.inboundRateLimiter.start();
  }

  stop(): void {
    for (const [method, version, encoding] of protocolsSupported) {
      this.libp2p.unhandle(formatProtocolId(method, version, encoding));
    }
    this.controller.abort();
    this.inboundRateLimiter.stop();
  }

  async status(peerId: PeerId, request: phase0.Status): Promise<phase0.Status> {
    return await this.sendRequest<phase0.Status>(peerId, Method.Status, [Version.V1], request);
  }

  async goodbye(peerId: PeerId, request: phase0.Goodbye): Promise<void> {
    await this.sendRequest<phase0.Goodbye>(peerId, Method.Goodbye, [Version.V1], request);
  }

  async ping(peerId: PeerId): Promise<phase0.Ping> {
    return await this.sendRequest<phase0.Ping>(peerId, Method.Ping, [Version.V1], this.metadataController.seqNumber);
  }

  async metadata(peerId: PeerId, fork?: ForkName): Promise<allForks.Metadata> {
    // Only request V1 if forcing phase0 fork. It's safe to not specify `fork` and let stream negotiation pick the version
    const versions = fork === ForkName.phase0 ? [Version.V1] : [Version.V2, Version.V1];
    return await this.sendRequest<allForks.Metadata>(peerId, Method.Metadata, versions, null);
  }

  async beaconBlocksByRange(
    peerId: PeerId,
    request: phase0.BeaconBlocksByRangeRequest
  ): Promise<allForks.SignedBeaconBlock[]> {
    const blocks = await this.sendRequest<allForks.SignedBeaconBlock[]>(
      peerId,
      Method.BeaconBlocksByRange,
      [Version.V2, Version.V1], // Prioritize V2
      request,
      request.count
    );
    assertSequentialBlocksInRange(blocks, request);
    return blocks;
  }

  async beaconBlocksByRoot(
    peerId: PeerId,
    request: phase0.BeaconBlocksByRootRequest
  ): Promise<allForks.SignedBeaconBlock[]> {
    return await this.sendRequest<allForks.SignedBeaconBlock[]>(
      peerId,
      Method.BeaconBlocksByRoot,
      [Version.V2, Version.V1], // Prioritize V2
      request,
      request.length
    );
  }

  pruneRateLimiterData(peerId: PeerId): void {
    this.inboundRateLimiter.prune(peerId);
  }

  // Helper to reduce code duplication
  private async sendRequest<T extends IncomingResponseBody | IncomingResponseBody[]>(
    peerId: PeerId,
    method: Method,
    versions: Version[],
    body: RequestBody,
    maxResponses = 1
  ): Promise<T> {
    try {
      this.metrics?.reqRespOutgoingRequests.inc({method});

      const encoding = this.peerMetadata.encoding.get(peerId) ?? Encoding.SSZ_SNAPPY;
      const result = await sendRequest<T>(
        {forkDigestContext: this.config, logger: this.logger, libp2p: this.libp2p},
        peerId,
        method,
        encoding,
        versions,
        body,
        maxResponses,
        this.controller.signal,
        this.options,
        this.reqCount++
      );

      return result;
    } catch (e) {
      this.metrics?.reqRespOutgoingErrors.inc({method});

      const peerAction = onOutgoingReqRespError(e as Error, method);
      if (
        e instanceof RequestError &&
        (e.type.code === RequestErrorCode.DIAL_ERROR || e.type.code === RequestErrorCode.DIAL_TIMEOUT)
      ) {
        this.metrics?.reqRespDialErrors.inc();
      }
      if (peerAction !== null) this.peerRpcScores.applyAction(peerId, peerAction);

      throw e;
    }
  }

  private getRequestHandler({method, version, encoding}: Protocol) {
    return async ({connection, stream}: {connection: Connection; stream: Libp2pStream}) => {
      const peerId = connection.remotePeer;

      // TODO: Do we really need this now that there is only one encoding?
      // Remember the prefered encoding of this peer
      if (method === Method.Status) {
        this.peerMetadata.encoding.set(peerId, encoding);
      }

      try {
        this.metrics?.reqRespIncomingRequests.inc({method});

        await handleRequest(
          {config: this.config, logger: this.logger, libp2p: this.libp2p},
          this.onRequest.bind(this),
          stream,
          peerId,
          {method, version, encoding},
          this.controller.signal,
          this.respCount++
        );
        // TODO: Do success peer scoring here
      } catch {
        this.metrics?.reqRespIncomingErrors.inc({method});

        // TODO: Do error peer scoring here
        // Must not throw since this is an event handler
      }
    };
  }

  private async *onRequest(
    protocol: Protocol,
    requestBody: RequestBody,
    peerId: PeerId
  ): AsyncIterable<OutgoingResponseBody> {
    const requestTyped = {method: protocol.method, body: requestBody} as RequestTypedContainer;

    if (requestTyped.method !== Method.Goodbye && !this.inboundRateLimiter.allowRequest(peerId, requestTyped)) {
      throw new ResponseError(RespStatus.RATE_LIMITED, "rate limit");
    }

    switch (requestTyped.method) {
      case Method.Ping:
        yield this.metadataController.seqNumber;
        break;
      case Method.Metadata:
        // V1 -> phase0, V2 -> altair. But the type serialization of phase0.Metadata will just ignore the extra .syncnets property
        // It's safe to return altair.Metadata here for all versions
        yield this.metadataController.json;
        break;
      case Method.Goodbye:
        yield BigInt(0);
        break;

      // Don't bubble Ping, Metadata, and, Goodbye requests to the app layer

      case Method.Status:
        yield* this.reqRespHandlers.onStatus();
        break;
      case Method.BeaconBlocksByRange:
        yield* this.reqRespHandlers.onBeaconBlocksByRange(requestTyped.body);
        break;
      case Method.BeaconBlocksByRoot:
        yield* this.reqRespHandlers.onBeaconBlocksByRoot(requestTyped.body);
        break;

      default:
        throw Error(`Unsupported method ${protocol.method}`);
    }

    // Allow onRequest to return and close the stream
    // For Goodbye there may be a race condition where the listener of `receivedGoodbye`
    // disconnects in the same syncronous call, preventing the stream from ending cleanly
    setTimeout(() => this.networkEventBus.emit(NetworkEvent.reqRespRequest, requestTyped, peerId), 0);
  }
}
