/* eslint-disable @typescript-eslint/naming-convention */
import {PeerId} from "@libp2p/interface-peer-id";
import {Libp2p} from "libp2p";
import {BeaconConfig} from "@lodestar/config";
import {ForkName, ForkSeq} from "@lodestar/params";
import {
  Encoding,
  ProtocolDescriptor,
  ProtocolHandler,
  ProtocolNoHandler,
  ReqResp,
  ReqRespMethod,
  ReqRespOpts,
  RequestError,
  RequestIncoming,
  ResponseIncoming,
  ResponseOutgoing,
  Version,
} from "@lodestar/reqresp";
import {allForks, altair, deneb, phase0, Root} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {protocols as reqRespProtocols} from "@lodestar/reqresp";
import {NetworkCoreMetrics} from "../core/metrics.js";
import {INetworkEventBus, NetworkEvent} from "../events.js";
import {MetadataController} from "../metadata.js";
import {PeersData} from "../peers/peersData.js";
import {IPeerRpcScoreStore, PeerAction} from "../peers/score.js";
import {ReqRespHandlers} from "./handlers/index.js";
import {IReqRespBeaconNode} from "./interface.js";
import {onOutgoingReqRespError} from "./score.js";
import {collectSequentialBlocksInRange} from "./utils/collectSequentialBlocksInRange.js";
import {collectExactOneTyped, collectMaxResponseTyped} from "./utils/collect.js";
import {RequestTypedContainer} from "./types.js";

export {getReqRespHandlers, ReqRespHandlers} from "./handlers/index.js";
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

const ReqRespMethodWithVersions = {
  ...ReqRespMethod,
  MetadataV2: "metadata/v2",
  BeaconBlocksByRangeV2: "beacon_blocks_by_range/v2",
  BeaconBlocksByRootV2: "beacon_blocks_by_root/v2",
} as const;

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
  private readonly protocols: Record<keyof typeof ReqRespMethodWithVersions, ProtocolNoHandler>;
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
    this.protocols = {
      Status: reqRespProtocols.Status(this.config),
      Goodbye: reqRespProtocols.Goodbye(this.config),
      Ping: reqRespProtocols.Ping(this.config),
      Metadata: reqRespProtocols.Metadata(this.config),
      MetadataV2: reqRespProtocols.MetadataV2(this.config),
      BeaconBlocksByRange: reqRespProtocols.BeaconBlocksByRange(this.config),
      BeaconBlocksByRangeV2: reqRespProtocols.BeaconBlocksByRangeV2(this.config),
      BeaconBlocksByRoot: reqRespProtocols.BeaconBlocksByRoot(this.config),
      BeaconBlocksByRootV2: reqRespProtocols.BeaconBlocksByRootV2(this.config),
      BlobsSidecarsByRange: reqRespProtocols.BlobsSidecarsByRange(this.config),
      LightClientBootstrap: reqRespProtocols.LightClientBootstrap(this.config),
      LightClientFinalityUpdate: reqRespProtocols.LightClientFinalityUpdate(this.config),
      LightClientUpdatesByRange: reqRespProtocols.LightClientUpdatesByRange(this.config),
      LightClientOptimisticUpdate: reqRespProtocols.LightClientOptimisticUpdate(this.config),
      BeaconBlockAndBlobsSidecarByRoot: reqRespProtocols.BeaconBlockAndBlobsSidecarByRoot(this.config),
    };
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
      this.protocols.Status,
      this.sendRequestTyped(this.protocols.Status, peerId, [Version.V1], request)
    );
  }

  async goodbye(peerId: PeerId, request: phase0.Goodbye): Promise<void> {
    // TODO: Replace with "ignore response after request"
    await collectExactOneTyped(
      this.protocols.Goodbye,
      this.sendRequestTyped(this.protocols.Goodbye, peerId, [Version.V1], request)
    );
  }

  async ping(peerId: PeerId): Promise<phase0.Ping> {
    return collectExactOneTyped(
      this.protocols.Ping,
      this.sendRequestTyped(this.protocols.Ping, peerId, [Version.V1], this.metadataController.seqNumber)
    );
  }

  async metadata(peerId: PeerId): Promise<allForks.Metadata> {
    return collectExactOneTyped(
      this.protocols.Metadata,
      this.sendRequestTyped(
        this.protocols.Metadata,
        peerId,
        this.currentRegisteredFork >= ForkSeq.altair ? [Version.V2] : [(Version.V2, Version.V1)],
        null
      )
    );
  }

  async beaconBlocksByRange(
    peerId: PeerId,
    request: phase0.BeaconBlocksByRangeRequest
  ): Promise<allForks.SignedBeaconBlock[]> {
    return collectSequentialBlocksInRange(
      this.protocols.BeaconBlocksByRange,
      this.sendRequestTyped(
        this.protocols.BeaconBlocksByRange,
        peerId,
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
      this.protocols.BeaconBlocksByRoot,
      this.sendRequestTyped(
        this.protocols.BeaconBlocksByRoot,
        peerId,
        this.currentRegisteredFork >= ForkSeq.altair ? [Version.V2] : [(Version.V2, Version.V1)],
        request
      ),
      request.length
    );
  }

  async lightClientBootstrap(peerId: PeerId, request: Root): Promise<allForks.LightClientBootstrap> {
    return collectExactOneTyped(
      this.protocols.LightClientBootstrap,
      this.sendRequestTyped(this.protocols.LightClientBootstrap, peerId, [Version.V1], request)
    );
  }

  async lightClientOptimisticUpdate(peerId: PeerId): Promise<allForks.LightClientOptimisticUpdate> {
    return collectExactOneTyped(
      this.protocols.LightClientOptimisticUpdate,
      this.sendRequestTyped(this.protocols.LightClientOptimisticUpdate, peerId, [Version.V1], null)
    );
  }

  async lightClientFinalityUpdate(peerId: PeerId): Promise<allForks.LightClientFinalityUpdate> {
    return collectExactOneTyped(
      this.protocols.LightClientFinalityUpdate,
      this.sendRequestTyped(this.protocols.LightClientFinalityUpdate, peerId, [Version.V1], null)
    );
  }

  async lightClientUpdatesByRange(
    peerId: PeerId,
    request: altair.LightClientUpdatesByRange
  ): Promise<allForks.LightClientUpdate[]> {
    return collectMaxResponseTyped(
      this.protocols.LightClientUpdatesByRange,
      this.sendRequestTyped(this.protocols.LightClientUpdatesByRange, peerId, [Version.V1], request),
      request.count
    );
  }

  async blobsSidecarsByRange(
    peerId: PeerId,
    request: deneb.BlobsSidecarsByRangeRequest
  ): Promise<deneb.BlobsSidecar[]> {
    return collectMaxResponseTyped(
      this.protocols.BlobsSidecarsByRange,
      this.sendRequestTyped(this.protocols.BlobsSidecarsByRange, peerId, [Version.V1], request),
      request.count
    );
  }

  async beaconBlockAndBlobsSidecarByRoot(
    peerId: PeerId,
    request: deneb.BeaconBlockAndBlobsSidecarByRootRequest
  ): Promise<deneb.SignedBeaconBlockAndBlobsSidecar[]> {
    return collectMaxResponseTyped(
      this.protocols.BeaconBlockAndBlobsSidecarByRoot,
      this.sendRequestTyped(this.protocols.BeaconBlockAndBlobsSidecarByRoot, peerId, [Version.V1], request),
      request.length
    );
  }

  /**
   * Returns the list of protocols that must be subscribed during a specific fork.
   * Any protocol not in this list must be un-subscribed.
   */
  private getProtocolsAtFork(fork: ForkName): [ProtocolNoHandler, ProtocolHandler][] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const protocols: [ProtocolNoHandler, ProtocolHandler][] = [
      [this.protocols.Ping, this.onPing.bind(this)],
      [this.protocols.Status, this.onStatus.bind(this)],
      [this.protocols.Goodbye, this.onGoodbye.bind(this)],
      // Support V2 methods as soon as implemented (for altair)
      // Ref https://github.com/ethereum/consensus-specs/blob/v1.2.0/specs/altair/p2p-interface.md#transitioning-from-v1-to-v2
      [this.protocols.MetadataV2, this.onMetadata.bind(this)],
      [this.protocols.BeaconBlocksByRangeV2, this.reqRespHandlers.onBeaconBlocksByRange],
      [this.protocols.BeaconBlocksByRootV2, this.reqRespHandlers.onBeaconBlocksByRoot],
    ];

    if (ForkSeq[fork] < ForkSeq.altair) {
      // Unregister V1 topics at the fork boundary, so only declare for pre-altair
      protocols.push(
        [this.protocols.Metadata, this.onMetadata.bind(this)],
        [this.protocols.BeaconBlocksByRange, this.reqRespHandlers.onBeaconBlocksByRange],
        [this.protocols.BeaconBlocksByRoot, this.reqRespHandlers.onBeaconBlocksByRoot]
      );
    }

    if (ForkSeq[fork] >= ForkSeq.altair) {
      // Should be okay to enable before altair, but for consistency only enable afterwards
      protocols.push(
        [this.protocols.LightClientBootstrap, this.reqRespHandlers.onLightClientBootstrap],
        [this.protocols.LightClientFinalityUpdate, this.reqRespHandlers.onLightClientFinalityUpdate],
        [this.protocols.LightClientOptimisticUpdate, this.reqRespHandlers.onLightClientOptimisticUpdate],
        [this.protocols.LightClientUpdatesByRange, this.reqRespHandlers.onLightClientUpdatesByRange]
      );
    }

    if (ForkSeq[fork] >= ForkSeq.deneb) {
      protocols.push(
        [this.protocols.BeaconBlockAndBlobsSidecarByRoot, this.reqRespHandlers.onBeaconBlockAndBlobsSidecarByRoot],
        [this.protocols.BlobsSidecarsByRange, this.reqRespHandlers.onBlobsSidecarsByRange]
      );
    }

    return protocols;
  }

  protected sendRequestTyped<Req>(
    protocol: ProtocolDescriptor,
    peerId: PeerId,
    versions: number[],
    request: Req
  ): AsyncIterable<ResponseIncoming> {
    // Remember prefered encoding
    const encoding = this.peersData.getEncodingPreference(peerId.toString()) ?? Encoding.SSZ_SNAPPY;

    const requestEncoded = protocol.requestEncoder
      ? protocol.requestEncoder.serialize(request as never)
      : EMPTY_REQUEST;

    return super.sendRequest(peerId, protocol.method, versions, encoding, requestEncoded);
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

  private async *onStatus(
    protocol: ProtocolDescriptor,
    req: RequestIncoming,
    peerId: PeerId
  ): AsyncIterable<ResponseOutgoing> {
    const body = protocol.requestEncoder?.deserialize(req.data) as phase0.Status;
    this.onIncomingRequestBody({method: ReqRespMethod.Status, body}, peerId);
    yield* this.reqRespHandlers.onStatus(body, peerId);
  }

  private async *onGoodbye(
    protocol: ProtocolDescriptor,
    req: RequestIncoming,
    peerId: PeerId
  ): AsyncIterable<ResponseOutgoing> {
    const body = protocol.requestEncoder?.deserialize(req.data) as phase0.Goodbye;
    this.onIncomingRequestBody({method: ReqRespMethod.Goodbye, body}, peerId);

    yield {
      data: protocol.responseEncoder(ForkName.phase0).serialize(BigInt(0)),
      // Goodbye topic is fork-agnostic
      fork: ForkName.phase0,
    };
  }

  private async *onPing(
    protocol: ProtocolDescriptor,
    req: RequestIncoming,
    peerId: PeerId
  ): AsyncIterable<ResponseOutgoing> {
    const body = protocol.requestEncoder?.deserialize(req.data) as phase0.Ping;
    this.onIncomingRequestBody({method: ReqRespMethod.Ping, body}, peerId);
    yield {
      data: protocol.responseEncoder(ForkName.phase0).serialize(this.metadataController.seqNumber),
      // Ping topic is fork-agnostic
      fork: ForkName.phase0,
    };
  }

  private async *onMetadata(
    protocol: ProtocolDescriptor,
    _req: RequestIncoming,
    peerId: PeerId
  ): AsyncIterable<ResponseOutgoing> {
    this.onIncomingRequestBody({method: ReqRespMethod.Metadata, body: null}, peerId);

    const metadata = this.metadataController.json;
    // Metadata topic is fork-agnostic
    const fork = ForkName.phase0;
    const type = protocol.responseEncoder(fork);

    yield {
      data: type.serialize(metadata),
      fork,
    };
  }
}
