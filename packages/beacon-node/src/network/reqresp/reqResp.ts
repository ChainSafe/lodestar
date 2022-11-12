import {PeerId} from "@libp2p/interface-peer-id";
import {Type} from "@chainsafe/ssz";
import {ForkName} from "@lodestar/params";
import {allForks, altair, phase0, Root, Slot, ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {RespStatus, timeoutOptions} from "../../constants/index.js";
import {MetadataController} from "../metadata.js";
import {IPeerRpcScoreStore} from "../peers/score.js";
import {INetworkEventBus, NetworkEvent} from "../events.js";
import {IReqResp, IReqRespModules, IRateLimiter} from "./interface.js";
import {ResponseError} from "./response/index.js";
import {assertSequentialBlocksInRange} from "./utils/index.js";
import {ReqRespHandlers} from "./handlers/index.js";
import {
  Method,
  Version,
  Encoding,
  ContextBytesType,
  ContextBytesFactory,
  EncodedPayload,
  EncodedPayloadType,
  RequestTypedContainer,
} from "./types.js";
import {InboundRateLimiter, RateLimiterOpts} from "./response/rateLimiter.js";
import {ReqRespProtocol} from "./reqRespProtocol.js";
import {RequestError} from "./request/errors.js";
import {onOutgoingReqRespError} from "./score.js";

export type IReqRespOptions = Partial<typeof timeoutOptions>;

/** This type helps response to beacon_block_by_range and beacon_block_by_root more efficiently */
export type ReqRespBlockResponse = {
  /** Deserialized data of allForks.SignedBeaconBlock */
  bytes: Uint8Array;
  slot: Slot;
};

/**
 * Implementation of Ethereum Consensus p2p Req/Resp domain.
 * For the spec that this code is based on, see:
 * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/p2p-interface.md#the-reqresp-domain
 * https://github.com/ethereum/consensus-specs/blob/dev/specs/altair/light-client/p2p-interface.md#the-reqresp-domain
 */
export class ReqResp extends ReqRespProtocol implements IReqResp {
  private reqRespHandlers: ReqRespHandlers;
  private metadataController: MetadataController;
  private peerRpcScores: IPeerRpcScoreStore;
  private inboundRateLimiter: IRateLimiter;
  private networkEventBus: INetworkEventBus;

  constructor(modules: IReqRespModules, options: IReqRespOptions & RateLimiterOpts) {
    super(modules, options);

    const {reqRespHandlers, config} = modules;

    // Single chunk protocols

    this.registerProtocol<phase0.Status, phase0.Status>({
      method: Method.Status,
      version: Version.V1,
      encoding: Encoding.SSZ_SNAPPY,
      handler: this.onStatus.bind(this),
      requestType: () => ssz.phase0.Status,
      responseType: () => ssz.phase0.Status,
      contextBytes: {type: ContextBytesType.Empty},
      isSingleResponse: true,
    });

    this.registerProtocol<phase0.Goodbye, phase0.Goodbye>({
      method: Method.Goodbye,
      version: Version.V1,
      encoding: Encoding.SSZ_SNAPPY,
      handler: this.onGoodbye.bind(this),
      requestType: () => ssz.phase0.Goodbye,
      responseType: () => ssz.phase0.Goodbye,
      renderRequestBody: (req) => req.toString(10),
      contextBytes: {type: ContextBytesType.Empty},
      isSingleResponse: true,
    });

    this.registerProtocol<phase0.Ping, phase0.Ping>({
      method: Method.Ping,
      version: Version.V1,
      encoding: Encoding.SSZ_SNAPPY,
      handler: this.onPing.bind(this),
      requestType: () => ssz.phase0.Ping,
      responseType: () => ssz.phase0.Ping,
      renderRequestBody: (req) => req.toString(10),
      contextBytes: {type: ContextBytesType.Empty},
      isSingleResponse: true,
    });

    // V1 -> phase0.Metadata, V2 -> altair.Metadata
    for (const [version, responseType] of [
      [Version.V1, ssz.phase0.Metadata],
      [Version.V2, ssz.altair.Metadata],
    ] as [Version, Type<allForks.Metadata>][]) {
      this.registerProtocol<null, allForks.Metadata>({
        method: Method.Metadata,
        version,
        encoding: Encoding.SSZ_SNAPPY,
        handler: this.onMetadata.bind(this),
        requestType: () => null,
        responseType: () => responseType,
        contextBytes: {type: ContextBytesType.Empty},
        isSingleResponse: true,
      });
    }

    // Block by protocols

    const contextBytesEmpty = {type: ContextBytesType.Empty};

    const contextBytesBlocksByV2: ContextBytesFactory<allForks.SignedBeaconBlock> = {
      type: ContextBytesType.ForkDigest,
      forkDigestContext: config,
      forkFromResponse: (block) => config.getForkName(block.message.slot),
    };

    for (const [version, contextBytes] of [
      [Version.V1, contextBytesEmpty],
      [Version.V2, contextBytesBlocksByV2],
    ] as [Version, ContextBytesFactory<allForks.SignedBeaconBlock>][]) {
      this.registerProtocol<phase0.BeaconBlocksByRangeRequest, allForks.SignedBeaconBlock>({
        method: Method.BeaconBlocksByRange,
        version,
        encoding: Encoding.SSZ_SNAPPY,
        handler: this.onBeaconBlocksByRange.bind(this),
        requestType: () => ssz.phase0.BeaconBlocksByRangeRequest,
        responseType: (forkName) => ssz[forkName].SignedBeaconBlock,
        renderRequestBody: (req) => `${req.startSlot},${req.step},${req.count}`,
        contextBytes,
        isSingleResponse: false,
      });

      this.registerProtocol<phase0.BeaconBlocksByRootRequest, allForks.SignedBeaconBlock>({
        method: Method.BeaconBlocksByRoot,
        version,
        encoding: Encoding.SSZ_SNAPPY,
        handler: this.onBeaconBlocksByRoot.bind(this),
        requestType: () => ssz.phase0.BeaconBlocksByRootRequest,
        responseType: (forkName) => ssz[forkName].SignedBeaconBlock,
        renderRequestBody: (req) => req.map((root) => toHex(root)).join(","),
        contextBytes,
        isSingleResponse: false,
      });
    }

    // Lightclient methods

    function getContextBytesLightclient<T>(forkFromResponse: (response: T) => ForkName): ContextBytesFactory<T> {
      return {
        type: ContextBytesType.ForkDigest,
        forkDigestContext: config,
        forkFromResponse,
      };
    }

    this.registerProtocol<Root, altair.LightClientBootstrap>({
      method: Method.LightClientBootstrap,
      version: Version.V1,
      encoding: Encoding.SSZ_SNAPPY,
      handler: reqRespHandlers.onLightClientBootstrap,
      requestType: () => ssz.Root,
      responseType: () => ssz.altair.LightClientBootstrap,
      renderRequestBody: (req) => toHex(req),
      contextBytes: getContextBytesLightclient((bootstrap) => config.getForkName(bootstrap.header.slot)),
      isSingleResponse: true,
    });

    this.registerProtocol<altair.LightClientUpdatesByRange, altair.LightClientUpdate>({
      method: Method.LightClientUpdatesByRange,
      version: Version.V1,
      encoding: Encoding.SSZ_SNAPPY,
      handler: reqRespHandlers.onLightClientUpdatesByRange,
      requestType: () => ssz.altair.LightClientUpdatesByRange,
      responseType: () => ssz.altair.LightClientUpdate,
      renderRequestBody: (req) => `${req.startPeriod},${req.count}`,
      contextBytes: getContextBytesLightclient((update) => config.getForkName(update.signatureSlot)),
      isSingleResponse: false,
    });

    this.registerProtocol<null, altair.LightClientFinalityUpdate>({
      method: Method.LightClientFinalityUpdate,
      version: Version.V1,
      encoding: Encoding.SSZ_SNAPPY,
      handler: reqRespHandlers.onLightClientFinalityUpdate,
      requestType: () => null,
      responseType: () => ssz.altair.LightClientFinalityUpdate,
      contextBytes: getContextBytesLightclient((update) => config.getForkName(update.signatureSlot)),
      isSingleResponse: true,
    });

    this.registerProtocol<null, altair.LightClientOptimisticUpdate>({
      method: Method.LightClientOptimisticUpdate,
      version: Version.V1,
      encoding: Encoding.SSZ_SNAPPY,
      handler: reqRespHandlers.onLightClientOptimisticUpdate,
      requestType: () => null,
      responseType: () => ssz.altair.LightClientOptimisticUpdate,
      contextBytes: getContextBytesLightclient((update) => config.getForkName(update.signatureSlot)),
      isSingleResponse: true,
    });

    this.reqRespHandlers = modules.reqRespHandlers;
    this.metadataController = modules.metadata;
    this.peerRpcScores = modules.peerRpcScores;
    this.inboundRateLimiter = new InboundRateLimiter(options, {...modules});
    this.networkEventBus = modules.networkEventBus;
  }

  async start(): Promise<void> {
    await super.start();
    this.inboundRateLimiter.start();
  }

  async stop(): Promise<void> {
    await super.stop();
    this.inboundRateLimiter.stop();
  }

  pruneOnPeerDisconnect(peerId: PeerId): void {
    this.inboundRateLimiter.prune(peerId);
  }

  async status(peerId: PeerId, request: phase0.Status): Promise<phase0.Status> {
    return await this.sendRequest<phase0.Status, phase0.Status>(peerId, Method.Status, [Version.V1], request);
  }

  async goodbye(peerId: PeerId, request: phase0.Goodbye): Promise<void> {
    await this.sendRequest<phase0.Goodbye, phase0.Goodbye>(peerId, Method.Goodbye, [Version.V1], request);
  }

  async ping(peerId: PeerId): Promise<phase0.Ping> {
    return await this.sendRequest<phase0.Ping, phase0.Ping>(
      peerId,
      Method.Ping,
      [Version.V1],
      this.metadataController.seqNumber
    );
  }

  async metadata(peerId: PeerId, fork?: ForkName): Promise<allForks.Metadata> {
    // Only request V1 if forcing phase0 fork. It's safe to not specify `fork` and let stream negotiation pick the version
    const versions = fork === ForkName.phase0 ? [Version.V1] : [Version.V2, Version.V1];
    return await this.sendRequest<null, allForks.Metadata>(peerId, Method.Metadata, versions, null);
  }

  async beaconBlocksByRange(
    peerId: PeerId,
    request: phase0.BeaconBlocksByRangeRequest
  ): Promise<allForks.SignedBeaconBlock[]> {
    const blocks = await this.sendRequest<phase0.BeaconBlocksByRangeRequest, allForks.SignedBeaconBlock[]>(
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
    return await this.sendRequest<phase0.BeaconBlocksByRootRequest, allForks.SignedBeaconBlock[]>(
      peerId,
      Method.BeaconBlocksByRoot,
      [Version.V2, Version.V1], // Prioritize V2
      request,
      request.length
    );
  }

  async lightClientBootstrap(peerId: PeerId, request: Root): Promise<altair.LightClientBootstrap> {
    return await this.sendRequest<Root, altair.LightClientBootstrap>(
      peerId,
      Method.LightClientBootstrap,
      [Version.V1],
      request
    );
  }

  async lightClientOptimisticUpdate(peerId: PeerId): Promise<altair.LightClientOptimisticUpdate> {
    return await this.sendRequest<null, altair.LightClientOptimisticUpdate>(
      peerId,
      Method.LightClientOptimisticUpdate,
      [Version.V1],
      null
    );
  }

  async lightClientFinalityUpdate(peerId: PeerId): Promise<altair.LightClientFinalityUpdate> {
    return await this.sendRequest<null, altair.LightClientFinalityUpdate>(
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
    return await this.sendRequest<altair.LightClientUpdatesByRange, altair.LightClientUpdate[]>(
      peerId,
      Method.LightClientUpdatesByRange,
      [Version.V1],
      request,
      request.count
    );
  }

  /**
   * @override Rate limit requests before decoding request body
   */
  protected onIncomingRequest(peerId: PeerId, method: Method): void {
    if (method !== Method.Goodbye && !this.inboundRateLimiter.allowRequest(peerId)) {
      throw new ResponseError(RespStatus.RATE_LIMITED, "rate limit");
    }
  }

  protected onOutgoingReqRespError(peerId: PeerId, method: Method, error: RequestError): void {
    const peerAction = onOutgoingReqRespError(error, method);
    if (peerAction !== null) {
      this.peerRpcScores.applyAction(peerId, peerAction, error.type.code);
    }
  }

  private onIncomingRequestBody(req: RequestTypedContainer, peerId: PeerId): void {
    // Allow onRequest to return and close the stream
    // For Goodbye there may be a race condition where the listener of `receivedGoodbye`
    // disconnects in the same syncronous call, preventing the stream from ending cleanly
    setTimeout(() => this.networkEventBus.emit(NetworkEvent.reqRespRequest, req, peerId), 0);
  }

  private async *onStatus(req: phase0.Status, peerId: PeerId): AsyncIterable<EncodedPayload<phase0.Status>> {
    this.onIncomingRequestBody({method: Method.Status, body: req}, peerId);
    yield* this.reqRespHandlers.onStatus();
  }

  private async *onGoodbye(req: phase0.Goodbye, peerId: PeerId): AsyncIterable<EncodedPayload<phase0.Goodbye>> {
    this.onIncomingRequestBody({method: Method.Goodbye, body: req}, peerId);
    yield {type: EncodedPayloadType.ssz, data: BigInt(0)};
  }

  private async *onPing(req: phase0.Ping, peerId: PeerId): AsyncIterable<EncodedPayload<phase0.Ping>> {
    this.onIncomingRequestBody({method: Method.Goodbye, body: req}, peerId);
    yield {type: EncodedPayloadType.ssz, data: this.metadataController.seqNumber};
  }

  private async *onMetadata(req: null, peerId: PeerId): AsyncIterable<EncodedPayload<allForks.Metadata>> {
    this.onIncomingRequestBody({method: Method.Metadata, body: req}, peerId);

    // V1 -> phase0, V2 -> altair. But the type serialization of phase0.Metadata will just ignore the extra .syncnets property
    // It's safe to return altair.Metadata here for all versions
    yield {type: EncodedPayloadType.ssz, data: this.metadataController.json};
  }

  private async *onBeaconBlocksByRange(
    req: phase0.BeaconBlocksByRangeRequest,
    peerId: PeerId
  ): AsyncIterable<EncodedPayload<allForks.SignedBeaconBlock>> {
    if (!this.inboundRateLimiter.allowBlockByRequest(peerId, req.count)) {
      throw new ResponseError(RespStatus.RATE_LIMITED, "rate limit");
    }
    yield* this.reqRespHandlers.onBeaconBlocksByRange(req);
  }

  private async *onBeaconBlocksByRoot(
    req: phase0.BeaconBlocksByRootRequest,
    peerId: PeerId
  ): AsyncIterable<EncodedPayload<allForks.SignedBeaconBlock>> {
    if (!this.inboundRateLimiter.allowBlockByRequest(peerId, req.length)) {
      throw new ResponseError(RespStatus.RATE_LIMITED, "rate limit");
    }
    yield* this.reqRespHandlers.onBeaconBlocksByRoot(req);
  }
}
