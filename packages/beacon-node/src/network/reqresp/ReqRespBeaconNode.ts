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
import {allForks, phase0, ssz} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {INetworkEventBus, NetworkEvent} from "../events.js";
import {MetadataController} from "../metadata.js";
import {PeersData} from "../peers/peersData.js";
import {IPeerRpcScoreStore, PeerAction} from "../peers/score/index.js";
import {NetworkCoreMetrics} from "../core/metrics.js";
import {StatusCache} from "../statusCache.js";
import {onOutgoingReqRespError} from "./score.js";
import {
  GetReqRespHandlerFn,
  ProtocolNoHandler,
  ReqRespMethod,
  RequestTypedContainer,
  Version,
  requestSszTypeByMethod,
  responseSszTypeByMethod,
} from "./types.js";
import * as protocols from "./protocols.js";
import {collectExactOneTyped} from "./utils/collect.js";

export {getReqRespHandlers} from "./handlers/index.js";
export {ReqRespMethod, RequestTypedContainer} from "./types.js";

export interface ReqRespBeaconNodeModules {
  libp2p: Libp2p;
  peersData: PeersData;
  logger: Logger;
  config: BeaconConfig;
  metrics: NetworkCoreMetrics | null;
  metadata: MetadataController;
  peerRpcScores: IPeerRpcScoreStore;
  events: INetworkEventBus;
  statusCache: StatusCache;
  getHandler: GetReqRespHandlerFn;
}

export type ReqRespBeaconNodeOpts = ReqRespOpts;

/**
 * Implementation of Ethereum Consensus p2p Req/Resp domain.
 * For the spec that this code is based on, see:
 * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/p2p-interface.md#the-reqresp-domain
 * https://github.com/ethereum/consensus-specs/blob/dev/specs/altair/light-client/p2p-interface.md#the-reqresp-domain
 */
export class ReqRespBeaconNode extends ReqResp {
  private readonly metadataController: MetadataController;
  private readonly peerRpcScores: IPeerRpcScoreStore;
  private readonly networkEventBus: INetworkEventBus;
  private readonly peersData: PeersData;
  private readonly statusCache: StatusCache;
  private readonly getHandler: GetReqRespHandlerFn;

  /** Track registered fork to only send to known protocols */
  private currentRegisteredFork: ForkSeq = ForkSeq.phase0;

  private readonly config: BeaconConfig;
  protected readonly logger: Logger;

  constructor(modules: ReqRespBeaconNodeModules, options: ReqRespBeaconNodeOpts = {}) {
    const {events, peersData, peerRpcScores, metadata, metrics, logger} = modules;

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

    this.peerRpcScores = peerRpcScores;
    this.peersData = peersData;
    this.config = modules.config;
    this.logger = logger;
    this.metadataController = metadata;
    this.networkEventBus = events;
    this.statusCache = modules.statusCache;
    this.getHandler = modules.getHandler;
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

  sendRequestWithoutEncoding(
    peerId: PeerId,
    method: ReqRespMethod,
    versions: number[],
    requestData: Uint8Array
  ): AsyncIterable<ResponseIncoming> {
    // Remember prefered encoding
    const encoding = this.peersData.getEncodingPreference(peerId.toString()) ?? Encoding.SSZ_SNAPPY;

    // Overwritte placeholder requestData from main thread with correct sequenceNumber
    if (method === ReqRespMethod.Ping) {
      requestData = requestSszTypeByMethod[ReqRespMethod.Ping].serialize(this.metadataController.seqNumber);
    }

    // ReqResp outgoing request, emit from main thread to worker
    return this.sendRequest(peerId, method, versions, encoding, requestData);
  }

  async sendPing(peerId: PeerId): Promise<phase0.Ping> {
    return collectExactOneTyped(
      // Ping method request data is overwritten in worker with correct sequence number
      this.sendReqRespRequest(peerId, ReqRespMethod.Ping, [Version.V1], this.metadataController.seqNumber),
      responseSszTypeByMethod[ReqRespMethod.Ping]
    );
  }

  async sendStatus(peerId: PeerId, request: phase0.Status): Promise<phase0.Status> {
    return collectExactOneTyped(
      this.sendReqRespRequest(peerId, ReqRespMethod.Status, [Version.V1], request),
      responseSszTypeByMethod[ReqRespMethod.Status]
    );
  }

  async sendGoodbye(peerId: PeerId, request: phase0.Goodbye): Promise<void> {
    // TODO: Replace with "ignore response after request"
    await collectExactOneTyped(
      this.sendReqRespRequest(peerId, ReqRespMethod.Goodbye, [Version.V1], request),
      responseSszTypeByMethod[ReqRespMethod.Goodbye]
    );
  }

  async sendMetadata(peerId: PeerId): Promise<allForks.Metadata> {
    return collectExactOneTyped(
      this.sendReqRespRequest(
        peerId,
        ReqRespMethod.Metadata,
        // Before altair, prioritize V2. After altair only request V2
        this.currentRegisteredFork >= ForkSeq.altair ? [Version.V2] : [(Version.V2, Version.V1)],
        null
      ),
      responseSszTypeByMethod[ReqRespMethod.Metadata]
    );
  }

  private sendReqRespRequest<Req>(
    peerId: PeerId,
    method: ReqRespMethod,
    versions: number[],
    request: Req
  ): AsyncIterable<ResponseIncoming> {
    const requestType = requestSszTypeByMethod[method];
    const requestData = requestType ? requestType.serialize(request as never) : new Uint8Array();
    return this.sendRequestWithoutEncoding(peerId, method, versions, requestData);
  }

  /**
   * Returns the list of protocols that must be subscribed during a specific fork.
   * Any protocol not in this list must be un-subscribed.
   */
  private getProtocolsAtFork(fork: ForkName): [ProtocolNoHandler, ProtocolHandler][] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const protocolsAtFork: [ProtocolNoHandler, ProtocolHandler][] = [
      [protocols.Ping(this.config), this.onPing.bind(this)],
      [protocols.Status(this.config), this.onStatus.bind(this)],
      [protocols.Goodbye(this.config), this.onGoodbye.bind(this)],
      // Support V2 methods as soon as implemented (for altair)
      // Ref https://github.com/ethereum/consensus-specs/blob/v1.2.0/specs/altair/p2p-interface.md#transitioning-from-v1-to-v2
      [protocols.MetadataV2(this.config), this.onMetadata.bind(this)],
      [protocols.BeaconBlocksByRangeV2(this.config), this.getHandler(ReqRespMethod.BeaconBlocksByRange)],
      [protocols.BeaconBlocksByRootV2(this.config), this.getHandler(ReqRespMethod.BeaconBlocksByRoot)],
    ];

    if (ForkSeq[fork] < ForkSeq.altair) {
      // Unregister V1 topics at the fork boundary, so only declare for pre-altair
      protocolsAtFork.push(
        [protocols.Metadata(this.config), this.onMetadata.bind(this)],
        [protocols.BeaconBlocksByRange(this.config), this.getHandler(ReqRespMethod.BeaconBlocksByRange)],
        [protocols.BeaconBlocksByRoot(this.config), this.getHandler(ReqRespMethod.BeaconBlocksByRoot)]
      );
    }

    if (ForkSeq[fork] >= ForkSeq.altair) {
      // Should be okay to enable before altair, but for consistency only enable afterwards
      protocolsAtFork.push(
        [protocols.LightClientBootstrap(this.config), this.getHandler(ReqRespMethod.LightClientBootstrap)],
        [protocols.LightClientFinalityUpdate(this.config), this.getHandler(ReqRespMethod.LightClientFinalityUpdate)],
        [
          protocols.LightClientOptimisticUpdate(this.config),
          this.getHandler(ReqRespMethod.LightClientOptimisticUpdate),
        ],
        [protocols.LightClientUpdatesByRange(this.config), this.getHandler(ReqRespMethod.LightClientUpdatesByRange)]
      );
    }

    if (ForkSeq[fork] >= ForkSeq.deneb) {
      protocolsAtFork.push(
        [protocols.BlobSidecarsByRoot(this.config), this.getHandler(ReqRespMethod.BlobSidecarsByRoot)],
        [protocols.BlobSidecarsByRange(this.config), this.getHandler(ReqRespMethod.BlobSidecarsByRange)]
      );
    }

    return protocolsAtFork;
  }

  protected onIncomingRequestBody(request: RequestTypedContainer, peer: PeerId): void {
    // Allow onRequest to return and close the stream
    // For Goodbye there may be a race condition where the listener of `receivedGoodbye`
    // disconnects in the same syncronous call, preventing the stream from ending cleanly
    setTimeout(() => this.networkEventBus.emit(NetworkEvent.reqRespRequest, {request, peer}), 0);
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

    yield {
      data: ssz.phase0.Status.serialize(this.statusCache.get()),
      // Status topic is fork-agnostic
      fork: ForkName.phase0,
    };
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
