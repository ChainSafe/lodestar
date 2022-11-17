import {PeerId} from "@libp2p/interface-peer-id";
import {ForkName} from "@lodestar/params";
import {allForks, altair, phase0, Root, Slot} from "@lodestar/types";
import {DIAL_TIMEOUT, REQUEST_TIMEOUT, RESP_TIMEOUT, TTFB_TIMEOUT} from "./constants.js";
import {IReqResp, RateLimiter, ReqRespHandlerContext, ReqRespModules, RespStatus} from "./interface.js";
import {InboundRateLimiter, RateLimiterOptions} from "./rate_limiter/RateLimiter.js";
import {ReqRespProtocol} from "./ReqRespProtocol.js";
import {RequestError} from "./request/errors.js";
import {ResponseError} from "./response/errors.js";
import {onOutgoingReqRespError} from "./score.js";
import {IPeerRpcScoreStore, MetadataController} from "./sharedTypes.js";
import {Method, ReqRespOptions, Version} from "./types.js";
import {assertSequentialBlocksInRange} from "./utils/index.js";

/** This type helps response to beacon_block_by_range and beacon_block_by_root more efficiently */
export type ReqRespBlockResponse = {
  /** Deserialized data of allForks.SignedBeaconBlock */
  bytes: Uint8Array;
  slot: Slot;
};

export const defaultReqRespOptions: ReqRespOptions = {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  TTFB_TIMEOUT,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  RESP_TIMEOUT,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  REQUEST_TIMEOUT,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  DIAL_TIMEOUT,
};

/**
 * Implementation of Ethereum Consensus p2p Req/Resp domain.
 * For the spec that this code is based on, see:
 * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/p2p-interface.md#the-reqresp-domain
 * https://github.com/ethereum/consensus-specs/blob/dev/specs/altair/light-client/p2p-interface.md#the-reqresp-domain
 */
export abstract class ReqResp extends ReqRespProtocol<ReqRespHandlerContext> implements IReqResp {
  private inboundRateLimiter: RateLimiter;
  private peerRpcScores: IPeerRpcScoreStore;
  private metadataController: MetadataController;

  constructor(modules: ReqRespModules, options?: Partial<ReqRespOptions> & Partial<RateLimiterOptions>) {
    super(modules, {...defaultReqRespOptions, ...options});
    this.peerRpcScores = modules.peerRpcScores;
    this.metadataController = modules.metadataController;
    this.inboundRateLimiter = new InboundRateLimiter({...InboundRateLimiter.defaults, ...options}, modules);
  }

  protected onIncomingRequest(peerId: PeerId, method: Method): void {
    if (method !== Method.Goodbye && !this.inboundRateLimiter.allowRequest(peerId)) {
      throw new ResponseError(RespStatus.RATE_LIMITED, "rate limit");
    }
  }

  protected onOutgoingRequestError(peerId: PeerId, method: Method, error: RequestError): void {
    const peerAction = onOutgoingReqRespError(error, method);
    if (peerAction !== null) {
      this.peerRpcScores.applyAction(peerId, peerAction, error.type.code);
    }
  }

  protected getContext(): ReqRespHandlerContext {
    const context = super.getContext();
    return {
      ...context,
      modules: {
        ...context.modules,
        inboundRateLimiter: this.inboundRateLimiter,
        metadataController: this.metadataController,
      },
    };
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
}
