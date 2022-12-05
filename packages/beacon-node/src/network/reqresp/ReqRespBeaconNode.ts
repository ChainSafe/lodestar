import {PeerId} from "@libp2p/interface-peer-id";
import {Libp2p} from "libp2p";
import {IBeaconConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
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
import * as messages from "@lodestar/reqresp/messages";
import {allForks, altair, phase0, Root} from "@lodestar/types";
import {ILogger} from "@lodestar/utils";
import {IMetrics} from "../../metrics/metrics.js";
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

export interface ReqRespBeaconNodeModules {
  libp2p: Libp2p;
  peersData: PeersData;
  logger: ILogger;
  config: IBeaconConfig;
  metrics: IMetrics | null;
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

  constructor(modules: ReqRespBeaconNodeModules, options: ReqRespBeaconNodeOpts = {}) {
    const {reqRespHandlers, networkEventBus, peersData, peerRpcScores, metadata, logger, metrics} = modules;

    super(
      {
        ...modules,
        metricsRegister: metrics?.register ?? null,
        reportPeer: (peerId) => peerRpcScores.applyAction(peerId, PeerAction.Fatal, "rate_limit_rpc"),
      },
      options
    );

    this.reqRespHandlers = reqRespHandlers;
    this.peerRpcScores = peerRpcScores;
    this.peersData = peersData;
    this.metadataController = metadata;
    this.networkEventBus = networkEventBus;

    // TODO: Do not register everything! Some protocols are fork dependant
    this.registerProtocol(messages.Ping(this.onPing.bind(this)));
    this.registerProtocol(messages.Status(modules, this.onStatus.bind(this)));
    this.registerProtocol(messages.Metadata(modules, this.onMetadata.bind(this)));
    this.registerProtocol(messages.MetadataV2(modules, this.onMetadata.bind(this)));
    this.registerProtocol(messages.Goodbye(modules, this.onGoodbye.bind(this)));
    this.registerProtocol(messages.BeaconBlocksByRange(modules, this.onBeaconBlocksByRange.bind(this)));
    this.registerProtocol(messages.BeaconBlocksByRangeV2(modules, this.onBeaconBlocksByRange.bind(this)));
    this.registerProtocol(messages.BeaconBlocksByRoot(modules, this.onBeaconBlocksByRoot.bind(this)));
    this.registerProtocol(messages.BeaconBlocksByRootV2(modules, this.onBeaconBlocksByRoot.bind(this)));
    this.registerProtocol(messages.LightClientBootstrap(modules, reqRespHandlers.onLightClientBootstrap));
    this.registerProtocol(messages.LightClientFinalityUpdate(modules, reqRespHandlers.onLightClientFinalityUpdate));
    this.registerProtocol(messages.LightClientOptimisticUpdate(modules, reqRespHandlers.onLightClientOptimisticUpdate));
    this.registerProtocol(messages.LightClientUpdatesByRange(modules, reqRespHandlers.onLightClientUpdatesByRange));
  }

  async start(): Promise<void> {
    await super.start();
  }

  async stop(): Promise<void> {
    await super.stop();
  }

  pruneOnPeerDisconnect(peerId: PeerId): void {
    this.rateLimiter.prune(peerId);
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

  async metadata(peerId: PeerId, fork?: ForkName): Promise<allForks.Metadata> {
    // Only request V1 if forcing phase0 fork. It's safe to not specify `fork` and let stream negotiation pick the version
    const versions = fork === ForkName.phase0 ? [Version.V1] : [Version.V2, Version.V1];
    return collectExactOne(this.sendRequest<null, allForks.Metadata>(peerId, ReqRespMethod.Metadata, versions, null));
  }

  async beaconBlocksByRange(
    peerId: PeerId,
    request: phase0.BeaconBlocksByRangeRequest
  ): Promise<allForks.SignedBeaconBlock[]> {
    return collectSequentialBlocksInRange(
      this.sendRequest<phase0.BeaconBlocksByRangeRequest, allForks.SignedBeaconBlock>(
        peerId,
        ReqRespMethod.BeaconBlocksByRange,
        [Version.V2, Version.V1], // Prioritize V2
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
        [Version.V2, Version.V1], // Prioritize V2
        request
      ),
      request.length
    );
  }

  async lightClientBootstrap(peerId: PeerId, request: Root): Promise<altair.LightClientBootstrap> {
    return collectExactOne(
      this.sendRequest<Root, altair.LightClientBootstrap>(
        peerId,
        ReqRespMethod.LightClientBootstrap,
        [Version.V1],
        request
      )
    );
  }

  async lightClientOptimisticUpdate(peerId: PeerId): Promise<altair.LightClientOptimisticUpdate> {
    return collectExactOne(
      this.sendRequest<null, altair.LightClientOptimisticUpdate>(
        peerId,
        ReqRespMethod.LightClientOptimisticUpdate,
        [Version.V1],
        null
      )
    );
  }

  async lightClientFinalityUpdate(peerId: PeerId): Promise<altair.LightClientFinalityUpdate> {
    return collectExactOne(
      this.sendRequest<null, altair.LightClientFinalityUpdate>(
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
  ): Promise<altair.LightClientUpdate[]> {
    return collectMaxResponse(
      this.sendRequest<altair.LightClientUpdatesByRange, altair.LightClientUpdate>(
        peerId,
        ReqRespMethod.LightClientUpdatesByRange,
        [Version.V1],
        request
      ),
      request.count
    );
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
