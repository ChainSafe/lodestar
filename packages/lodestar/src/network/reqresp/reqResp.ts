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
import {EventEmitter} from "events";
import {AbortController} from "abort-controller";
import LibP2p from "libp2p";
import PeerId from "peer-id";
import {IReqResp} from "../interface";
import {IReqEventEmitterClass, IReqRespModules, ReqRespHandler, ILibP2pStream} from "./interface";
import {sendRequest} from "./request";
import {handleRequest} from "./response";
import {Method, ReqRespEncoding} from "../../constants";
import {updateRpcScore} from "../error";
import {IPeerMetadataStore} from "../peers/interface";
import {IRpcScoreTracker, RpcScoreEvent} from "../peers/score";
import {createRpcProtocol} from "../util";

/**
 * Implementation of eth2 p2p Req/Resp domain.
 * For the spec that this code is based on, see:
 * https://github.com/ethereum/eth2.0-specs/blob/dev/specs/phase0/p2p-interface.md#the-reqresp-domain
 */
export class ReqResp extends (EventEmitter as IReqEventEmitterClass) implements IReqResp {
  private config: IBeaconConfig;
  private libp2p: LibP2p;
  private logger: ILogger;
  private peerMetadata: IPeerMetadataStore;
  private blockProviderScores: IRpcScoreTracker;
  private controller: AbortController | undefined;

  /**
   * @see this.registerHandler
   */
  private performRequestHandler: ReqRespHandler | null;

  public constructor({config, libp2p, peerMetadata, blockProviderScores, logger}: IReqRespModules) {
    super();
    this.config = config;
    this.libp2p = libp2p;
    this.peerMetadata = peerMetadata;
    this.logger = logger;
    this.blockProviderScores = blockProviderScores;

    this.performRequestHandler = null;
  }

  public async start(): Promise<void> {
    this.controller = new AbortController();
    for (const method of Object.values(Method)) {
      for (const encoding of Object.values(ReqRespEncoding)) {
        this.libp2p.handle(createRpcProtocol(method, encoding), async ({connection, stream}) => {
          const peerId = connection.remotePeer;
          this.storePeerEncodingPreference(peerId, method, encoding);

          try {
            if (!this.performRequestHandler) {
              throw Error("performRequestHandler not registered");
            }

            await handleRequest(
              this.config,
              this.performRequestHandler,
              stream as ILibP2pStream,
              peerId,
              method,
              encoding
            );
          } catch (e) {
            // Catch for: If yielding an error response fails
            // Catch for: If performRequestHandler is not registered
            stream.close();
          } finally {
            // TODO: Extra cleanup? Close connection?
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

  unregisterHandler(): void {
    this.performRequestHandler = null;
  }

  public async stop(): Promise<void> {
    for (const method of Object.values(Method)) {
      for (const encoding of Object.values(ReqRespEncoding)) {
        this.libp2p.unhandle(createRpcProtocol(method, encoding));
      }
    }
    this.controller?.abort();
  }

  public async status(peerId: PeerId, request: Status): Promise<Status | null> {
    return await this.sendRequest<Status>(peerId, Method.Status, request);
  }

  public async goodbye(peerId: PeerId, request: Goodbye): Promise<void> {
    await this.sendRequest<Goodbye>(peerId, Method.Goodbye, request);
  }

  public async ping(peerId: PeerId, request: Ping): Promise<Ping | null> {
    return await this.sendRequest<Ping>(peerId, Method.Ping, request);
  }

  public async metadata(peerId: PeerId): Promise<Metadata | null> {
    return await this.sendRequest<Metadata>(peerId, Method.Metadata, null);
  }

  public async beaconBlocksByRange(
    peerId: PeerId,
    request: BeaconBlocksByRangeRequest
  ): Promise<SignedBeaconBlock[] | null> {
    try {
      const result = await this.sendRequest<SignedBeaconBlock[]>(
        peerId,
        Method.BeaconBlocksByRange,
        request,
        request.count
      );
      this.blockProviderScores.update(peerId, RpcScoreEvent.SUCCESS_BLOCK_RANGE);
      return result;
    } catch (e) {
      updateRpcScore(this.blockProviderScores, peerId, e);
      throw e;
    }
  }

  public async beaconBlocksByRoot(
    peerId: PeerId,
    request: BeaconBlocksByRootRequest
  ): Promise<SignedBeaconBlock[] | null> {
    try {
      const result = await this.sendRequest<SignedBeaconBlock[]>(
        peerId,
        Method.BeaconBlocksByRoot,
        request,
        request.length
      );
      this.blockProviderScores.update(peerId, RpcScoreEvent.SUCCESS_BLOCK_ROOT);
      return result;
    } catch (e) {
      updateRpcScore(this.blockProviderScores, peerId, e);
      throw e;
    }
  }

  private storePeerEncodingPreference(peerId: PeerId, method: Method, encoding: ReqRespEncoding): void {
    const peerReputations = this.peerMetadata;
    if (method === Method.Status) {
      peerReputations.setEncoding(peerId, encoding);
    }
  }

  // Helper to reduce code duplication
  private async sendRequest<T extends ResponseBody | ResponseBody[]>(
    peerId: PeerId,
    method: Method,
    body: RequestBody,
    maxResponses?: number
  ): Promise<T | null> {
    return await sendRequest<T>(
      {libp2p: this.libp2p, logger: this.logger, config: this.config},
      peerId,
      method,
      this.peerMetadata.getEncoding(peerId) ?? ReqRespEncoding.SSZ_SNAPPY,
      body,
      maxResponses,
      this.controller?.signal
    );
  }
}
