/**
 * @module network
 */
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {
  BeaconBlocksByRangeRequest,
  BeaconBlocksByRootRequest,
  Goodbye,
  Metadata,
  Ping,
  RequestBody,
  ResponseBody,
  SignedBeaconBlock,
  Status,
} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {AbortController} from "abort-controller";
import LibP2p from "libp2p";
import PeerId from "peer-id";
import {IReqResp} from "../interface";
import {IReqRespModules, ReqRespHandler, ILibP2pStream} from "./interface";
import {sendRequest} from "./request";
import {handleRequest} from "./response";
import {Method, ReqRespEncoding, timeoutOptions} from "../../constants";
import {errorToScoreEvent, successToScoreEvent} from "./score";
import {IPeerMetadataStore} from "../peers/interface";
import {IRpcScoreTracker} from "../peers/score";
import {createRpcProtocol} from "../util";

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
  private peerMetadata: IPeerMetadataStore;
  private blockProviderScores: IRpcScoreTracker;
  private controller: AbortController | undefined;
  private options?: IReqRespOptions;

  /**
   * @see this.registerHandler
   */
  private performRequestHandler: ReqRespHandler | null;

  public constructor(
    {config, libp2p, peerMetadata, blockProviderScores, logger}: IReqRespModules,
    options?: IReqRespOptions
  ) {
    this.config = config;
    this.libp2p = libp2p;
    this.peerMetadata = peerMetadata;
    this.logger = logger;
    this.blockProviderScores = blockProviderScores;
    this.options = options;

    this.performRequestHandler = null;
  }

  public async start(): Promise<void> {
    this.controller = new AbortController();
    for (const method of Object.values(Method)) {
      for (const encoding of Object.values(ReqRespEncoding)) {
        this.libp2p.handle(createRpcProtocol(method, encoding), async ({connection, stream}) => {
          const peerId = connection.remotePeer;

          // Store peer encoding preference for this.sendRequest
          if (method === Method.Status) {
            this.peerMetadata.setEncoding(peerId, encoding);
          }

          if (!this.performRequestHandler) {
            stream.close();
            this.logger.error("performRequestHandler not registered", {method, peer: peerId.toB58String()});
            return;
          }

          try {
            await handleRequest(
              {config: this.config, logger: this.logger},
              this.performRequestHandler,
              stream as ILibP2pStream,
              peerId,
              method,
              encoding
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

  /**
   * ReqResp handler implementers MUST register the requestHandler with this method
   * Then this ReqResp instance will used the registered handler to serve requests
   */
  registerHandler(handler: ReqRespHandler): void {
    if (this.performRequestHandler) {
      throw new Error("Already registered handler");
    }
    this.performRequestHandler = handler;
  }

  unregisterHandler(): ReqRespHandler | null {
    const handler = this.performRequestHandler;
    this.performRequestHandler = null;
    return handler;
  }

  public async stop(): Promise<void> {
    for (const method of Object.values(Method)) {
      for (const encoding of Object.values(ReqRespEncoding)) {
        this.libp2p.unhandle(createRpcProtocol(method, encoding));
      }
    }
    this.controller?.abort();
  }

  public async status(peerId: PeerId, request: Status): Promise<Status> {
    return await this.sendRequest<Status>(peerId, Method.Status, request);
  }

  public async goodbye(peerId: PeerId, request: Goodbye): Promise<void> {
    await this.sendRequest<Goodbye>(peerId, Method.Goodbye, request);
  }

  public async ping(peerId: PeerId, request: Ping): Promise<Ping> {
    return await this.sendRequest<Ping>(peerId, Method.Ping, request);
  }

  public async metadata(peerId: PeerId): Promise<Metadata> {
    return await this.sendRequest<Metadata>(peerId, Method.Metadata, null);
  }

  public async beaconBlocksByRange(peerId: PeerId, request: BeaconBlocksByRangeRequest): Promise<SignedBeaconBlock[]> {
    return await this.sendRequest<SignedBeaconBlock[]>(peerId, Method.BeaconBlocksByRange, request, request.count);
  }

  public async beaconBlocksByRoot(peerId: PeerId, request: BeaconBlocksByRootRequest): Promise<SignedBeaconBlock[]> {
    return await this.sendRequest<SignedBeaconBlock[]>(peerId, Method.BeaconBlocksByRoot, request, request.length);
  }

  // Helper to reduce code duplication
  private async sendRequest<T extends ResponseBody | ResponseBody[]>(
    peerId: PeerId,
    method: Method,
    body: RequestBody,
    maxResponses?: number
  ): Promise<T> {
    try {
      const encoding = this.peerMetadata.getEncoding(peerId) ?? ReqRespEncoding.SSZ_SNAPPY;
      const result = await sendRequest<T>(
        {libp2p: this.libp2p, logger: this.logger, config: this.config},
        peerId,
        method,
        encoding,
        body,
        maxResponses,
        this.controller?.signal,
        this.options
      );

      this.blockProviderScores.update(peerId, successToScoreEvent(method));

      return result;
    } catch (e) {
      this.blockProviderScores.update(peerId, errorToScoreEvent(e, method));

      throw e;
    }
  }
}
