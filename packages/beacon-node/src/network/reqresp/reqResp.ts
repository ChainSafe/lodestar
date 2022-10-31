import {setMaxListeners} from "node:events";
import {Libp2p} from "libp2p";
import {PeerId} from "@libp2p/interface-peer-id";
import {Connection, Stream} from "@libp2p/interface-connection";
import {ForkName} from "@lodestar/params";
import {IBeaconConfig} from "@lodestar/config";
import {allForks, altair, phase0} from "@lodestar/types";
import {ILogger} from "@lodestar/utils";
import {RespStatus, timeoutOptions} from "../../constants/index.js";
import {PeersData} from "../peers/peersData.js";
import {MetadataController} from "../metadata.js";
import {IPeerRpcScoreStore} from "../peers/score.js";
import {INetworkEventBus, NetworkEvent} from "../events.js";
import {IMetrics} from "../../metrics/metrics.js";
import {IReqResp, IReqRespModules, IRateLimiter} from "./interface.js";
import {sendRequest} from "./request/index.js";
import {handleRequest, ResponseError} from "./response/index.js";
import {onOutgoingReqRespError} from "./score.js";
import {assertSequentialBlocksInRange, formatProtocolId} from "./utils/index.js";
import {ReqRespHandlers} from "./handlers/index.js";
import {RequestError, RequestErrorCode} from "./request/index.js";
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
} from "./types.js";
import {InboundRateLimiter, RateLimiterOpts} from "./response/rateLimiter.js";

export type IReqRespOptions = Partial<typeof timeoutOptions>;

/**
 * Implementation of Ethereum Consensus p2p Req/Resp domain.
 * For the spec that this code is based on, see:
 * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/p2p-interface.md#the-reqresp-domain
 * https://github.com/ethereum/consensus-specs/blob/dev/specs/altair/light-client/p2p-interface.md#the-reqresp-domain
 */
export class ReqResp implements IReqResp {
  private config: IBeaconConfig;
  private libp2p: Libp2p;
  private readonly peersData: PeersData;
  private logger: ILogger;
  private reqRespHandlers: ReqRespHandlers;
  private metadataController: MetadataController;
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
    this.peersData = modules.peersData;
    this.logger = modules.logger;
    this.reqRespHandlers = modules.reqRespHandlers;
    this.metadataController = modules.metadata;
    this.peerRpcScores = modules.peerRpcScores;
    this.inboundRateLimiter = new InboundRateLimiter(options, {...modules});
    this.networkEventBus = modules.networkEventBus;
    this.options = options;
    this.metrics = modules.metrics;
  }

  async start(): Promise<void> {
    this.controller = new AbortController();
    // We set infinity to prevent MaxListenersExceededWarning which get logged when listeners > 10
    // Since it is perfectly fine to have listeners > 10
    setMaxListeners(Infinity, this.controller.signal);
    for (const [method, version, encoding] of protocolsSupported) {
      await this.libp2p.handle(
        formatProtocolId(method, version, encoding),
        this.getRequestHandler({method, version, encoding})
      );
    }
    this.inboundRateLimiter.start();
  }

  async stop(): Promise<void> {
    for (const [method, version, encoding] of protocolsSupported) {
      await this.libp2p.unhandle(formatProtocolId(method, version, encoding));
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

  pruneOnPeerDisconnect(peerId: PeerId): void {
    this.inboundRateLimiter.prune(peerId);
  }

  async lightClientBootstrap(peerId: PeerId, request: Uint8Array): Promise<altair.LightClientBootstrap> {
    return await this.sendRequest<altair.LightClientBootstrap>(
      peerId,
      Method.LightClientBootstrap,
      [Version.V1],
      request
    );
  }

  async lightClientOptimisticUpdate(peerId: PeerId): Promise<altair.LightClientOptimisticUpdate> {
    return await this.sendRequest<altair.LightClientOptimisticUpdate>(
      peerId,
      Method.LightClientOptimisticUpdate,
      [Version.V1],
      null
    );
  }

  async lightClientFinalityUpdate(peerId: PeerId): Promise<altair.LightClientFinalityUpdate> {
    return await this.sendRequest<altair.LightClientFinalityUpdate>(
      peerId,
      Method.LightClientFinalityUpdate,
      [Version.V1],
      null
    );
  }

  async lightClientUpdate(
    peerId: PeerId,
    request: altair.LightClientUpdatesByRange
  ): Promise<altair.LightClientUpdate[]> {
    return await this.sendRequest<altair.LightClientUpdate[]>(
      peerId,
      Method.LightClientUpdate,
      [Version.V1],
      request,
      request.count
    );
  }

  // Helper to reduce code duplication
  private async sendRequest<T extends IncomingResponseBody | IncomingResponseBody[]>(
    peerId: PeerId,
    method: Method,
    versions: Version[],
    body: RequestBody,
    maxResponses = 1
  ): Promise<T> {
    this.metrics?.reqResp.outgoingRequests.inc({method});
    const timer = this.metrics?.reqResp.outgoingRequestRoundtripTime.startTimer({method});

    try {
      const encoding = this.peersData.getEncodingPreference(peerId.toString()) ?? Encoding.SSZ_SNAPPY;
      const result = await sendRequest<T>(
        {forkDigestContext: this.config, logger: this.logger, libp2p: this.libp2p, peersData: this.peersData},
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
      this.metrics?.reqResp.outgoingErrors.inc({method});

      if (e instanceof RequestError) {
        if (e.type.code === RequestErrorCode.DIAL_ERROR || e.type.code === RequestErrorCode.DIAL_TIMEOUT) {
          this.metrics?.reqResp.dialErrors.inc();
        }
        const peerAction = onOutgoingReqRespError(e, method);
        if (peerAction !== null) {
          this.peerRpcScores.applyAction(peerId, peerAction, e.type.code);
        }
      }

      throw e;
    } finally {
      timer?.();
    }
  }

  private getRequestHandler({method, version, encoding}: Protocol) {
    return async ({connection, stream}: {connection: Connection; stream: Stream}) => {
      const peerId = connection.remotePeer;

      // TODO: Do we really need this now that there is only one encoding?
      // Remember the prefered encoding of this peer
      if (method === Method.Status) {
        this.peersData.setEncodingPreference(peerId.toString(), encoding);
      }

      this.metrics?.reqResp.incomingRequests.inc({method});
      const timer = this.metrics?.reqResp.incomingRequestHandlerTime.startTimer({method});

      try {
        await handleRequest(
          {config: this.config, logger: this.logger, peersData: this.peersData},
          this.onRequest.bind(this),
          stream,
          peerId,
          {method, version, encoding},
          this.controller.signal,
          this.respCount++
        );
        // TODO: Do success peer scoring here
      } catch {
        this.metrics?.reqResp.incomingErrors.inc({method});

        // TODO: Do error peer scoring here
        // Must not throw since this is an event handler
      } finally {
        timer?.();
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
      case Method.LightClientBootstrap:
        yield* this.reqRespHandlers.onLightClientBootstrap(requestTyped.body);
        break;
      case Method.LightClientOptimisticUpdate:
        yield* this.reqRespHandlers.onLightClientOptimisticUpdate();
        break;
      case Method.LightClientFinalityUpdate:
        yield* this.reqRespHandlers.onLightClientFinalityUpdate();
        break;
      case Method.LightClientUpdate:
        yield* this.reqRespHandlers.onLightClientUpdatesByRange(requestTyped.body);
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
