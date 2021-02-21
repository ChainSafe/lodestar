/**
 * @module network
 */
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {phase0} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {AbortController} from "abort-controller";
import LibP2p from "libp2p";
import PeerId from "peer-id";
import {IReqResp} from "../interface";
import {IReqRespModules, ILibP2pStream} from "./interface";
import {sendRequest} from "./request";
import {handleRequest} from "./response";
import {Method, ReqRespEncoding, timeoutOptions} from "../../constants";
import {errorToScoreEvent, successToScoreEvent} from "./score";
import {IPeerMetadataStore} from "../peers";
import {IRpcScoreTracker} from "../peers/score";
import {createRpcProtocol} from "../util";
import {IReqRespHandler} from "./handlers";

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
  private reqRespHandler: IReqRespHandler;
  private peerMetadata: IPeerMetadataStore;
  private peerRpcScores: IRpcScoreTracker;
  private controller: AbortController | undefined;
  private options?: IReqRespOptions;
  private reqCount = 0;
  private respCount = 0;

  public constructor(modules: IReqRespModules, options?: IReqRespOptions) {
    this.config = modules.config;
    this.libp2p = modules.libp2p;
    this.logger = modules.logger;
    this.reqRespHandler = modules.reqRespHandler;
    this.peerMetadata = modules.peerMetadata;
    this.peerRpcScores = modules.peerRpcScores;
    this.options = options;
  }

  public start(): void {
    this.controller = new AbortController();
    for (const method of Object.values(Method)) {
      for (const encoding of Object.values(ReqRespEncoding)) {
        this.libp2p.handle(createRpcProtocol(method, encoding), async ({connection, stream}) => {
          const peerId = connection.remotePeer;

          // TODO: Do we really need this now that there is only one encoding?
          // Remember the prefered encoding of this peer
          if (method === Method.Status) {
            this.peerMetadata.encoding.set(peerId, encoding);
          }

          try {
            await handleRequest(
              {config: this.config, logger: this.logger},
              this.onRequest.bind(this),
              stream as ILibP2pStream,
              peerId,
              method,
              encoding,
              this.respCount++
            );
            // TODO: Do success peer scoring here
          } catch (e) {
            // TODO: Do error peer scoring here
            // Must not throw since this is an event handler
          }
        });
      }
    }
  }

  public stop(): void {
    for (const method of Object.values(Method)) {
      for (const encoding of Object.values(ReqRespEncoding)) {
        this.libp2p.unhandle(createRpcProtocol(method, encoding));
      }
    }
    this.controller?.abort();
  }

  public async status(peerId: PeerId, request: phase0.Status): Promise<phase0.Status> {
    return await this.sendRequest<phase0.Status>(peerId, Method.Status, request);
  }

  public async goodbye(peerId: PeerId, request: phase0.Goodbye): Promise<void> {
    // NOTE: Responding node may terminate the stream before completing the ReqResp protocol
    // TODO: Consider doing error handling here for `SSZ_SNAPPY_ERROR_SOURCE_ABORTED`
    await this.sendRequest<phase0.Goodbye>(peerId, Method.Goodbye, request);
  }

  public async ping(peerId: PeerId, request: phase0.Ping): Promise<phase0.Ping> {
    return await this.sendRequest<phase0.Ping>(peerId, Method.Ping, request);
  }

  public async metadata(peerId: PeerId): Promise<phase0.Metadata> {
    return await this.sendRequest<phase0.Metadata>(peerId, Method.Metadata, null);
  }

  public async beaconBlocksByRange(
    peerId: PeerId,
    request: phase0.BeaconBlocksByRangeRequest
  ): Promise<phase0.SignedBeaconBlock[]> {
    return await this.sendRequest<phase0.SignedBeaconBlock[]>(
      peerId,
      Method.BeaconBlocksByRange,
      request,
      request.count
    );
  }

  public async beaconBlocksByRoot(
    peerId: PeerId,
    request: phase0.BeaconBlocksByRootRequest
  ): Promise<phase0.SignedBeaconBlock[]> {
    return await this.sendRequest<phase0.SignedBeaconBlock[]>(
      peerId,
      Method.BeaconBlocksByRoot,
      request,
      request.length
    );
  }

  // Helper to reduce code duplication
  private async sendRequest<T extends phase0.ResponseBody | phase0.ResponseBody[]>(
    peerId: PeerId,
    method: Method,
    body: phase0.RequestBody,
    maxResponses?: number
  ): Promise<T> {
    try {
      const encoding = this.peerMetadata.encoding.get(peerId) ?? ReqRespEncoding.SSZ_SNAPPY;
      const result = await sendRequest<T>(
        {libp2p: this.libp2p, logger: this.logger, config: this.config},
        peerId,
        method,
        encoding,
        body,
        maxResponses,
        this.controller?.signal,
        this.options,
        this.reqCount++
      );

      this.peerRpcScores.update(peerId, successToScoreEvent(method));

      return result;
    } catch (e) {
      this.peerRpcScores.update(peerId, errorToScoreEvent(e, method));

      throw e;
    }
  }

  private async *onRequest(
    method: Method,
    requestBody: phase0.RequestBody,
    peerId: PeerId
  ): AsyncIterable<phase0.ResponseBody> {
    yield* this.reqRespHandler.onRequest(method, requestBody, peerId);
  }
}
