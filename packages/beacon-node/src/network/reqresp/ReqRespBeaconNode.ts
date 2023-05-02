import {PeerId} from "@libp2p/interface-peer-id";
import {Libp2p} from "libp2p";
import {BeaconConfig} from "@lodestar/config";
import {ForkName, ForkSeq} from "@lodestar/params";
import {
  Encoding,
  ProtocolDescriptor,
  ProtocolHandler,
  ReqResp,
  ReqRespOpts,
  ReqRespRequest,
  RequestError,
  ResponseIncoming,
  ResponseOutgoing,
} from "@lodestar/reqresp";
import {allForks, altair, deneb, phase0, Root, ssz} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {NetworkCoreMetrics} from "../core/metrics.js";
import {INetworkEventBus, NetworkEvent} from "../events.js";
import {MetadataController} from "../metadata.js";
import {PeersData} from "../peers/peersData.js";
import {IPeerRpcScoreStore, PeerAction} from "../peers/score.js";
import {ReqRespHandlers} from "./handlers/index.js";
import {IReqRespBeaconNode} from "./interface.js";
import {onOutgoingReqRespError} from "./score.js";
import {
  ProtocolNoHandler,
  ReqRespMethod,
  RequestTypedContainer,
  Version,
  requestSszTypeByMethod,
  responseSszTypeByMethod,
} from "./types.js";
import {collectSequentialBlocksInRange} from "./utils/collectSequentialBlocksInRange.js";
import {collectExactOneTyped, collectMaxResponseTyped} from "./utils/collect.js";
import * as reqRespProtocols from "./protocols.js";

export {getReqRespHandlers, ReqRespHandlers} from "./handlers/index.js";
export {ReqRespMethod, RequestTypedContainer} from "./types.js";
export {IReqRespBeaconNode};

export interface ReqRespBeaconNodeModules {
  libp2p: Libp2p;
  peersData: PeersData;
  logger: Logger;
  config: BeaconConfig;
  metrics: NetworkCoreMetrics | null;
  reqRespHandlers: ReqRespHandlers;
  metadata: MetadataController;
  peerRpcScores: IPeerRpcScoreStore;
  networkEventBus: INetworkEventBus;
}

export type ReqRespBeaconNodeOpts = ReqRespOpts;

const EMPTY_REQUEST = new Uint8Array();

/**
 * Implementation of Ethereum Consensus p2p Req/Resp domain.
 * For the spec that this code is based on, see:
 * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/p2p-interface.md#the-reqresp-domain
 * https://github.com/ethereum/consensus-specs/blob/dev/specs/altair/light-client/p2p-interface.md#the-reqresp-domain
 */
export class ReqRespBeaconNode extends ReqResp implements IReqRespBeaconNode {
  private readonly reqRespHandlers: ReqRespHandlers;
  private readonly metadataController: MetadataController;
  private readonly peerRpcScores: IPeerRpcScoreStore;
  private readonly networkEventBus: INetworkEventBus;
  private readonly peersData: PeersData;

  /** Track registered fork to only send to known protocols */
  private currentRegisteredFork: ForkSeq = ForkSeq.phase0;

  private readonly config: BeaconConfig;
  protected readonly logger: Logger;

  constructor(modules: ReqRespBeaconNodeModules, options: ReqRespBeaconNodeOpts = {}) {
    const {reqRespHandlers, networkEventBus, peersData, peerRpcScores, metadata, metrics, logger} = modules;

    super(
      {
        ...modules,
        metricsRegister: metrics?.register ?? null,
      },
      {
        ...options,
        onRateLimit(peerId, method) {
          logger.debug("Do not serve request due to rate limit", {peerId: peerId.toString()});
          peerRpcScores.applyAction(peerId, PeerAction.Fatal, "rate_limit_rpc");
          metrics?.reqResp.rateLimitErrors.inc({method});
        },
        getPeerLogMetadata(peerId) {
          return peersData.getPeerKind(peerId);
        },
      }
    );

    this.reqRespHandlers = reqRespHandlers;
    this.peerRpcScores = peerRpcScores;
    this.peersData = peersData;
    this.config = modules.config;
    this.logger = logger;
    this.metadataController = metadata;
    this.networkEventBus = networkEventBus;
  }

  async start(): Promise<void> {
    await super.start();
  }

  async stop(): Promise<void> {
    await super.stop();
  }

  // NOTE: Do not pruneOnPeerDisconnect. Persist peer rate limit data until pruned by time
  // pruneOnPeerDisconnect(peerId: PeerId): void {
  //   this.rateLimiter.prune(peerId);

  registerProtocolsAtFork(fork: ForkName): void {
    this.currentRegisteredFork = ForkSeq[fork];

    const mustSubscribeProtocols = this.getProtocolsAtFork(fork);
    const mustSubscribeProtocolIDs = new Set(
      mustSubscribeProtocols.map(([protocol]) => this.formatProtocolID(protocol))
    );

    // Un-subscribe not required protocols
    for (const protocolID of this.getRegisteredProtocols()) {
      if (!mustSubscribeProtocolIDs.has(protocolID)) {
        // Async because of writing to peerstore -_- should never throw
        this.unregisterProtocol(protocolID).catch((e) => {
          this.logger.error("Error on ReqResp.unregisterProtocol", {protocolID}, e);
        });
      }
    }

    // Subscribe required protocols, prevent libp2p for throwing if already registered
    for (const [protocol, handler] of mustSubscribeProtocols) {
      this.registerProtocol({...protocol, handler}, {ignoreIfDuplicate: true}).catch((e) => {
        this.logger.error("Error on ReqResp.registerProtocol", {protocolID: this.formatProtocolID(protocol)}, e);
      });
    }
  }

  async status(peerId: PeerId, request: phase0.Status): Promise<phase0.Status> {
    return collectExactOneTyped(
      this.sendRequestTyped(peerId, ReqRespMethod.Status, [Version.V1], request),
      responseSszTypeByMethod[ReqRespMethod.Status]
    );
  }

  async goodbye(peerId: PeerId, request: phase0.Goodbye): Promise<void> {
    // TODO: Replace with "ignore response after request"
    await collectExactOneTyped(
      this.sendRequestTyped(peerId, ReqRespMethod.Goodbye, [Version.V1], request),
      responseSszTypeByMethod[ReqRespMethod.Goodbye]
    );
  }

  async ping(peerId: PeerId): Promise<phase0.Ping> {
    return collectExactOneTyped(
      this.sendRequestTyped(peerId, ReqRespMethod.Ping, [Version.V1], this.metadataController.seqNumber),
      responseSszTypeByMethod[ReqRespMethod.Ping]
    );
  }

  async metadata(peerId: PeerId): Promise<allForks.Metadata> {
    return collectExactOneTyped(
      this.sendRequestTyped(
        peerId,
        ReqRespMethod.Metadata,
        // Before altair, prioritize V2. After altair only request V2
        this.currentRegisteredFork >= ForkSeq.altair ? [Version.V2] : [(Version.V2, Version.V1)],
        null
      ),
      responseSszTypeByMethod[ReqRespMethod.Metadata]
    );
  }

  async beaconBlocksByRange(
    peerId: PeerId,
    request: phase0.BeaconBlocksByRangeRequest
  ): Promise<allForks.SignedBeaconBlock[]> {
    return collectSequentialBlocksInRange(
      this.sendRequestTyped(
        peerId,
        ReqRespMethod.BeaconBlocksByRange,
        // Before altair, prioritize V2. After altair only request V2
        this.currentRegisteredFork >= ForkSeq.altair ? [Version.V2] : [(Version.V2, Version.V1)],
        request
      ),
      request
    );
  }

  async beaconBlocksByRoot(
    peerId: PeerId,
    request: phase0.BeaconBlocksByRootRequest
  ): Promise<allForks.SignedBeaconBlock[]> {
    return collectMaxResponseTyped(
      this.sendRequestTyped(
        peerId,
        ReqRespMethod.BeaconBlocksByRoot,
        // Before altair, prioritize V2. After altair only request V2
        this.currentRegisteredFork >= ForkSeq.altair ? [Version.V2] : [(Version.V2, Version.V1)],
        request
      ),
      request.length,
      responseSszTypeByMethod[ReqRespMethod.BeaconBlocksByRoot]
    );
  }

  async lightClientBootstrap(peerId: PeerId, request: Root): Promise<allForks.LightClientBootstrap> {
    return collectExactOneTyped(
      this.sendRequestTyped(peerId, ReqRespMethod.LightClientBootstrap, [Version.V1], request),
      responseSszTypeByMethod[ReqRespMethod.LightClientBootstrap]
    );
  }

  async lightClientOptimisticUpdate(peerId: PeerId): Promise<allForks.LightClientOptimisticUpdate> {
    return collectExactOneTyped(
      this.sendRequestTyped(peerId, ReqRespMethod.LightClientOptimisticUpdate, [Version.V1], null),
      responseSszTypeByMethod[ReqRespMethod.LightClientOptimisticUpdate]
    );
  }

  async lightClientFinalityUpdate(peerId: PeerId): Promise<allForks.LightClientFinalityUpdate> {
    return collectExactOneTyped(
      this.sendRequestTyped(peerId, ReqRespMethod.LightClientFinalityUpdate, [Version.V1], null),
      responseSszTypeByMethod[ReqRespMethod.LightClientFinalityUpdate]
    );
  }

  async lightClientUpdatesByRange(
    peerId: PeerId,
    request: altair.LightClientUpdatesByRange
  ): Promise<allForks.LightClientUpdate[]> {
    return collectMaxResponseTyped(
      this.sendRequestTyped(peerId, ReqRespMethod.LightClientUpdatesByRange, [Version.V1], request),
      request.count,
      responseSszTypeByMethod[ReqRespMethod.LightClientUpdatesByRange]
    );
  }

  async blobsSidecarsByRange(
    peerId: PeerId,
    request: deneb.BlobsSidecarsByRangeRequest
  ): Promise<deneb.BlobsSidecar[]> {
    return collectMaxResponseTyped(
      this.sendRequestTyped(peerId, ReqRespMethod.BlobsSidecarsByRange, [Version.V1], request),
      request.count,
      responseSszTypeByMethod[ReqRespMethod.BlobsSidecarsByRange]
    );
  }

  async beaconBlockAndBlobsSidecarByRoot(
    peerId: PeerId,
    request: deneb.BeaconBlockAndBlobsSidecarByRootRequest
  ): Promise<deneb.SignedBeaconBlockAndBlobsSidecar[]> {
    return collectMaxResponseTyped(
      this.sendRequestTyped(peerId, ReqRespMethod.BeaconBlockAndBlobsSidecarByRoot, [Version.V1], request),
      request.length,
      responseSszTypeByMethod[ReqRespMethod.BeaconBlockAndBlobsSidecarByRoot]
    );
  }

  /**
   * Returns the list of protocols that must be subscribed during a specific fork.
   * Any protocol not in this list must be un-subscribed.
   */
  private getProtocolsAtFork(fork: ForkName): [ProtocolNoHandler, ProtocolHandler][] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const protocols: [ProtocolNoHandler, ProtocolHandler][] = [
      [reqRespProtocols.Ping(this.config), this.onPing.bind(this)],
      [reqRespProtocols.Status(this.config), this.onStatus.bind(this)],
      [reqRespProtocols.Goodbye(this.config), this.onGoodbye.bind(this)],
      // Support V2 methods as soon as implemented (for altair)
      // Ref https://github.com/ethereum/consensus-specs/blob/v1.2.0/specs/altair/p2p-interface.md#transitioning-from-v1-to-v2
      [reqRespProtocols.MetadataV2(this.config), this.onMetadata.bind(this)],
      [reqRespProtocols.BeaconBlocksByRangeV2(this.config), this.reqRespHandlers.onBeaconBlocksByRange],
      [reqRespProtocols.BeaconBlocksByRootV2(this.config), this.reqRespHandlers.onBeaconBlocksByRoot],
    ];

    if (ForkSeq[fork] < ForkSeq.altair) {
      // Unregister V1 topics at the fork boundary, so only declare for pre-altair
      protocols.push(
        [reqRespProtocols.Metadata(this.config), this.onMetadata.bind(this)],
        [reqRespProtocols.BeaconBlocksByRange(this.config), this.reqRespHandlers.onBeaconBlocksByRange],
        [reqRespProtocols.BeaconBlocksByRoot(this.config), this.reqRespHandlers.onBeaconBlocksByRoot]
      );
    }

    if (ForkSeq[fork] >= ForkSeq.altair) {
      // Should be okay to enable before altair, but for consistency only enable afterwards
      protocols.push(
        [reqRespProtocols.LightClientBootstrap(this.config), this.reqRespHandlers.onLightClientBootstrap],
        [reqRespProtocols.LightClientFinalityUpdate(this.config), this.reqRespHandlers.onLightClientFinalityUpdate],
        [reqRespProtocols.LightClientOptimisticUpdate(this.config), this.reqRespHandlers.onLightClientOptimisticUpdate],
        [reqRespProtocols.LightClientUpdatesByRange(this.config), this.reqRespHandlers.onLightClientUpdatesByRange]
      );
    }

    if (ForkSeq[fork] >= ForkSeq.deneb) {
      protocols.push(
        [
          reqRespProtocols.BeaconBlockAndBlobsSidecarByRoot(this.config),
          this.reqRespHandlers.onBeaconBlockAndBlobsSidecarByRoot,
        ],
        [reqRespProtocols.BlobsSidecarsByRange(this.config), this.reqRespHandlers.onBlobsSidecarsByRange]
      );
    }

    return protocols;
  }

  protected sendRequestTyped<Req>(
    peerId: PeerId,
    method: ReqRespMethod,
    versions: number[],
    request: Req
  ): AsyncIterable<ResponseIncoming> {
    // Remember prefered encoding
    const encoding = this.peersData.getEncodingPreference(peerId.toString()) ?? Encoding.SSZ_SNAPPY;
    const requestType = requestSszTypeByMethod[method];
    const requestEncoded = requestType ? requestType.serialize(request as never) : EMPTY_REQUEST;
    return super.sendRequest(peerId, method, versions, encoding, requestEncoded);
  }

  protected onIncomingRequestBody(req: RequestTypedContainer, peerId: PeerId): void {
    // Allow onRequest to return and close the stream
    // For Goodbye there may be a race condition where the listener of `receivedGoodbye`
    // disconnects in the same syncronous call, preventing the stream from ending cleanly
    setTimeout(() => this.networkEventBus.emit(NetworkEvent.reqRespRequest, req, peerId), 0);
  }

  protected onIncomingRequest(peerId: PeerId, protocol: ProtocolDescriptor): void {
    // Remember prefered encoding
    if (protocol.method === ReqRespMethod.Status) {
      this.peersData.setEncodingPreference(peerId.toString(), protocol.encoding);
    }
  }

  protected onOutgoingRequestError(peerId: PeerId, method: ReqRespMethod, error: RequestError): void {
    const peerAction = onOutgoingReqRespError(error, method);
    if (peerAction !== null) {
      this.peerRpcScores.applyAction(peerId, peerAction, error.type.code);
    }
  }

  private async *onStatus(req: ReqRespRequest, peerId: PeerId): AsyncIterable<ResponseOutgoing> {
    const body = ssz.phase0.Status.deserialize(req.data);
    this.onIncomingRequestBody({method: ReqRespMethod.Status, body}, peerId);
    yield* this.reqRespHandlers.onStatus(body, peerId);
  }

  private async *onGoodbye(req: ReqRespRequest, peerId: PeerId): AsyncIterable<ResponseOutgoing> {
    const body = ssz.phase0.Goodbye.deserialize(req.data);
    this.onIncomingRequestBody({method: ReqRespMethod.Goodbye, body}, peerId);

    yield {
      data: ssz.phase0.Goodbye.serialize(BigInt(0)),
      // Goodbye topic is fork-agnostic
      fork: ForkName.phase0,
    };
  }

  private async *onPing(req: ReqRespRequest, peerId: PeerId): AsyncIterable<ResponseOutgoing> {
    const body = ssz.phase0.Ping.deserialize(req.data);
    this.onIncomingRequestBody({method: ReqRespMethod.Ping, body}, peerId);
    yield {
      data: ssz.phase0.Ping.serialize(this.metadataController.seqNumber),
      // Ping topic is fork-agnostic
      fork: ForkName.phase0,
    };
  }

  private async *onMetadata(req: ReqRespRequest, peerId: PeerId): AsyncIterable<ResponseOutgoing> {
    this.onIncomingRequestBody({method: ReqRespMethod.Metadata, body: null}, peerId);

    const metadata = this.metadataController.json;
    // Metadata topic is fork-agnostic
    const fork = ForkName.phase0;
    const type = responseSszTypeByMethod[ReqRespMethod.Metadata](fork, req.version);

    yield {
      data: type.serialize(metadata),
      fork,
    };
  }
}
