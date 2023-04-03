import {PeerId} from "@libp2p/interface-peer-id";
import {Libp2p} from "libp2p";
import {BeaconConfig} from "@lodestar/config";
import {ForkName, ForkSeq} from "@lodestar/params";
import {
  collectExactOne,
  collectMaxResponse,
  EncodedPayload,
  EncodedPayloadType,
  Encoding,
  ProtocolDefinition,
  ReqResp,
  RequestError,
} from "@lodestar/reqresp";
import {ReqRespOpts} from "@lodestar/reqresp/lib/ReqResp.js";
import * as reqRespProtocols from "@lodestar/reqresp/protocols";
import {allForks, altair, deneb, phase0, Root} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {Metrics} from "../../metrics/metrics.js";
import {INetworkEventBus, NetworkEvent} from "../events.js";
import {MetadataController} from "../metadata.js";
import {PeersData} from "../peers/peersData.js";
import {IPeerRpcScoreStore, PeerAction} from "../peers/score.js";
import {ReqRespHandlers} from "./handlers/index.js";
import {IReqRespBeaconNode} from "./interface.js";
import {onOutgoingReqRespError} from "./score.js";
import {ReqRespMethod, RequestTypedContainer, Version} from "./types.js";
import {collectSequentialBlocksInRange} from "./utils/collectSequentialBlocksInRange.js";

export {getReqRespHandlers, ReqRespHandlers} from "./handlers/index.js";
export {ReqRespMethod, RequestTypedContainer} from "./types.js";
export {IReqRespBeaconNode};

/** This type helps response to beacon_block_by_range and beacon_block_by_root more efficiently */
export type ReqRespBlockResponse = EncodedPayload<allForks.SignedBeaconBlock>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ProtocolDefinitionAny = ProtocolDefinition<any, any>;

export interface ReqRespBeaconNodeModules {
  libp2p: Libp2p;
  peersData: PeersData;
  logger: Logger;
  config: BeaconConfig;
  metrics: Metrics | null;
  reqRespHandlers: ReqRespHandlers;
  metadata: MetadataController;
  peerRpcScores: IPeerRpcScoreStore;
  networkEventBus: INetworkEventBus;
}

export type ReqRespBeaconNodeOpts = ReqRespOpts;

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
    const mustSubscribeProtocolIDs = new Set(mustSubscribeProtocols.map((protocol) => this.formatProtocolID(protocol)));

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
    for (const protocol of mustSubscribeProtocols) {
      this.registerProtocol(protocol, {ignoreIfDuplicate: true}).catch((e) => {
        this.logger.error("Error on ReqResp.registerProtocol", {protocolID: this.formatProtocolID(protocol)}, e);
      });
    }
  }

  async status(peerId: PeerId, request: phase0.Status): Promise<phase0.Status> {
    return collectExactOne(
      this.sendRequest<phase0.Status, phase0.Status>(peerId, ReqRespMethod.Status, [Version.V1], request)
    );
  }

  async goodbye(peerId: PeerId, request: phase0.Goodbye): Promise<void> {
    // TODO: Replace with "ignore response after request"
    await collectExactOne(
      this.sendRequest<phase0.Goodbye, phase0.Goodbye>(peerId, ReqRespMethod.Goodbye, [Version.V1], request)
    );
  }

  async ping(peerId: PeerId): Promise<phase0.Ping> {
    return collectExactOne(
      this.sendRequest<phase0.Ping, phase0.Ping>(
        peerId,
        ReqRespMethod.Ping,
        [Version.V1],
        this.metadataController.seqNumber
      )
    );
  }

  async metadata(peerId: PeerId): Promise<allForks.Metadata> {
    return collectExactOne(
      this.sendRequest<null, allForks.Metadata>(
        peerId,
        ReqRespMethod.Metadata,
        // Before altair, prioritize V2. After altair only request V2
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
      this.sendRequest<phase0.BeaconBlocksByRangeRequest, allForks.SignedBeaconBlock>(
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
    return collectMaxResponse(
      this.sendRequest<phase0.BeaconBlocksByRootRequest, allForks.SignedBeaconBlock>(
        peerId,
        ReqRespMethod.BeaconBlocksByRoot,
        // Before altair, prioritize V2. After altair only request V2
        this.currentRegisteredFork >= ForkSeq.altair ? [Version.V2] : [(Version.V2, Version.V1)],
        request
      ),
      request.length
    );
  }

  async lightClientBootstrap(peerId: PeerId, request: Root): Promise<allForks.LightClientBootstrap> {
    return collectExactOne(
      this.sendRequest<Root, allForks.LightClientBootstrap>(
        peerId,
        ReqRespMethod.LightClientBootstrap,
        [Version.V1],
        request
      )
    );
  }

  async lightClientOptimisticUpdate(peerId: PeerId): Promise<allForks.LightClientOptimisticUpdate> {
    return collectExactOne(
      this.sendRequest<null, allForks.LightClientOptimisticUpdate>(
        peerId,
        ReqRespMethod.LightClientOptimisticUpdate,
        [Version.V1],
        null
      )
    );
  }

  async lightClientFinalityUpdate(peerId: PeerId): Promise<allForks.LightClientFinalityUpdate> {
    return collectExactOne(
      this.sendRequest<null, allForks.LightClientFinalityUpdate>(
        peerId,
        ReqRespMethod.LightClientFinalityUpdate,
        [Version.V1],
        null
      )
    );
  }

  async lightClientUpdatesByRange(
    peerId: PeerId,
    request: altair.LightClientUpdatesByRange
  ): Promise<allForks.LightClientUpdate[]> {
    return collectMaxResponse(
      this.sendRequest<altair.LightClientUpdatesByRange, allForks.LightClientUpdate>(
        peerId,
        ReqRespMethod.LightClientUpdatesByRange,
        [Version.V1],
        request
      ),
      request.count
    );
  }

  async blobsSidecarsByRange(
    peerId: PeerId,
    request: deneb.BlobsSidecarsByRangeRequest
  ): Promise<deneb.BlobsSidecar[]> {
    return collectMaxResponse(
      this.sendRequest<deneb.BlobsSidecarsByRangeRequest, deneb.BlobsSidecar>(
        peerId,
        ReqRespMethod.BlobsSidecarsByRange,
        [Version.V1],
        request
      ),
      request.count
    );
  }

  async beaconBlockAndBlobsSidecarByRoot(
    peerId: PeerId,
    request: deneb.BeaconBlockAndBlobsSidecarByRootRequest
  ): Promise<deneb.SignedBeaconBlockAndBlobsSidecar[]> {
    return collectMaxResponse(
      this.sendRequest<deneb.BeaconBlockAndBlobsSidecarByRootRequest, deneb.SignedBeaconBlockAndBlobsSidecar>(
        peerId,
        ReqRespMethod.BeaconBlockAndBlobsSidecarByRoot,
        [Version.V1],
        request
      ),
      request.length
    );
  }

  /**
   * Returns the list of protocols that must be subscribed during a specific fork.
   * Any protocol not in this list must be un-subscribed.
   */
  private getProtocolsAtFork(fork: ForkName): ProtocolDefinitionAny[] {
    const modules = {config: this.config};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const protocols: ProtocolDefinition<any, any>[] = [
      reqRespProtocols.Ping(this.onPing.bind(this)),
      reqRespProtocols.Status(modules, this.onStatus.bind(this)),
      reqRespProtocols.Goodbye(modules, this.onGoodbye.bind(this)),
      // Support V2 methods as soon as implemented (for altair)
      // Ref https://github.com/ethereum/consensus-specs/blob/v1.2.0/specs/altair/p2p-interface.md#transitioning-from-v1-to-v2
      reqRespProtocols.MetadataV2(modules, this.onMetadata.bind(this)),
      reqRespProtocols.BeaconBlocksByRangeV2(modules, this.onBeaconBlocksByRange.bind(this)),
      reqRespProtocols.BeaconBlocksByRootV2(modules, this.onBeaconBlocksByRoot.bind(this)),
    ];

    if (ForkSeq[fork] < ForkSeq.altair) {
      // Unregister V1 topics at the fork boundary, so only declare for pre-altair
      protocols.push(
        reqRespProtocols.Metadata(modules, this.onMetadata.bind(this)),
        reqRespProtocols.BeaconBlocksByRange(modules, this.onBeaconBlocksByRange.bind(this)),
        reqRespProtocols.BeaconBlocksByRoot(modules, this.onBeaconBlocksByRoot.bind(this))
      );
    }

    if (ForkSeq[fork] >= ForkSeq.altair) {
      // Should be okay to enable before altair, but for consistency only enable afterwards
      protocols.push(
        reqRespProtocols.LightClientBootstrap(modules, this.reqRespHandlers.onLightClientBootstrap),
        reqRespProtocols.LightClientFinalityUpdate(modules, this.reqRespHandlers.onLightClientFinalityUpdate),
        reqRespProtocols.LightClientOptimisticUpdate(modules, this.reqRespHandlers.onLightClientOptimisticUpdate),
        reqRespProtocols.LightClientUpdatesByRange(modules, this.reqRespHandlers.onLightClientUpdatesByRange)
      );
    }

    if (ForkSeq[fork] >= ForkSeq.deneb) {
      protocols.push(
        reqRespProtocols.BeaconBlockAndBlobsSidecarByRoot(
          modules,
          this.reqRespHandlers.onBeaconBlockAndBlobsSidecarByRoot
        ),
        reqRespProtocols.BlobsSidecarsByRange(modules, this.reqRespHandlers.onBlobsSidecarsByRange)
      );
    }

    return protocols;
  }

  protected sendRequest<Req, Resp>(peerId: PeerId, method: string, versions: number[], body: Req): AsyncIterable<Resp> {
    // Remember prefered encoding
    const encoding = this.peersData.getEncodingPreference(peerId.toString()) ?? Encoding.SSZ_SNAPPY;

    return super.sendRequest(peerId, method, versions, encoding, body);
  }

  protected onIncomingRequestBody(req: RequestTypedContainer, peerId: PeerId): void {
    // Allow onRequest to return and close the stream
    // For Goodbye there may be a race condition where the listener of `receivedGoodbye`
    // disconnects in the same syncronous call, preventing the stream from ending cleanly
    setTimeout(() => this.networkEventBus.emit(NetworkEvent.reqRespRequest, req, peerId), 0);
  }

  protected onIncomingRequest(peerId: PeerId, protocol: ProtocolDefinition): void {
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

  private async *onStatus(req: phase0.Status, peerId: PeerId): AsyncIterable<EncodedPayload<phase0.Status>> {
    this.onIncomingRequestBody({method: ReqRespMethod.Status, body: req}, peerId);

    yield* this.reqRespHandlers.onStatus(req, peerId);
  }

  private async *onGoodbye(req: phase0.Goodbye, peerId: PeerId): AsyncIterable<EncodedPayload<phase0.Goodbye>> {
    this.onIncomingRequestBody({method: ReqRespMethod.Goodbye, body: req}, peerId);

    yield {type: EncodedPayloadType.ssz, data: BigInt(0)};
  }

  private async *onPing(req: phase0.Ping, peerId: PeerId): AsyncIterable<EncodedPayload<phase0.Ping>> {
    this.onIncomingRequestBody({method: ReqRespMethod.Ping, body: req}, peerId);
    yield {type: EncodedPayloadType.ssz, data: this.metadataController.seqNumber};
  }

  private async *onMetadata(req: null, peerId: PeerId): AsyncIterable<EncodedPayload<allForks.Metadata>> {
    this.onIncomingRequestBody({method: ReqRespMethod.Metadata, body: req}, peerId);

    // V1 -> phase0, V2 -> altair. But the type serialization of phase0.Metadata will just ignore the extra .syncnets property
    // It's safe to return altair.Metadata here for all versions
    yield {type: EncodedPayloadType.ssz, data: this.metadataController.json};
  }

  private async *onBeaconBlocksByRange(
    req: phase0.BeaconBlocksByRangeRequest,
    peerId: PeerId
  ): AsyncIterable<EncodedPayload<allForks.SignedBeaconBlock>> {
    yield* this.reqRespHandlers.onBeaconBlocksByRange(req, peerId);
  }

  private async *onBeaconBlocksByRoot(
    req: phase0.BeaconBlocksByRootRequest,
    peerId: PeerId
  ): AsyncIterable<EncodedPayload<allForks.SignedBeaconBlock>> {
    yield* this.reqRespHandlers.onBeaconBlocksByRoot(req, peerId);
  }
}
