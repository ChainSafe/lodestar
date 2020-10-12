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
import {EventEmitter} from "events";
import {pipe} from "it-pipe";
import LibP2p from "libp2p";
import PeerId from "peer-id";
import {IReqEventEmitterClass, IReqRespModules, ResponseEventListener, sendRequest} from ".";
import {Method, ReqRespEncoding, RequestId, RpcResponseStatus} from "../../constants";
import {IResponseChunk, IValidatedRequestBody} from "../encoders/interface";
import {eth2RequestDecode} from "../encoders/request";
import {encodeP2pErrorMessage, eth2ResponseEncode} from "../encoders/response";
import {RpcError, updateRpcScore} from "../error";
import {IReqResp, ResponseCallbackFn} from "../interface";
import {INetworkOptions} from "../options";
import {IPeerMetadataStore} from "../peers/interface";
import {IRpcScoreTracker, RpcScoreEvent} from "../peers/score";
import {createResponseEvent, createRpcProtocol, randomRequestId} from "../util";

export class ReqResp extends (EventEmitter as IReqEventEmitterClass) implements IReqResp {
  private config: IBeaconConfig;
  private libp2p: LibP2p;
  private logger: ILogger;
  private responseListener: ResponseEventListener;
  private peerMetadata: IPeerMetadataStore;
  private blockProviderScores: IRpcScoreTracker;
  private controller: AbortController | undefined;

  public constructor(
    opts: INetworkOptions,
    {config, libp2p, peerMetadata, blockProviderScores, logger}: IReqRespModules
  ) {
    super();
    this.config = config;
    this.libp2p = libp2p;
    this.peerMetadata = peerMetadata;
    this.logger = logger;
    this.blockProviderScores = blockProviderScores;
    this.responseListener = new ResponseEventListener();
  }
  public async start(): Promise<void> {
    this.controller = new AbortController();
    Object.values(Method).forEach((method) => {
      Object.values(ReqRespEncoding).forEach((encoding) => {
        this.libp2p.handle(createRpcProtocol(method, encoding), async ({connection, stream}) => {
          const peerId = connection.remotePeer;
          pipe(
            stream.source,
            eth2RequestDecode(this.config, this.logger, method, encoding),
            this.storePeerEncodingPreference(peerId, method, encoding),
            this.handleRpcRequest(peerId, method, encoding),
            eth2ResponseEncode(this.config, this.logger, method, encoding),
            stream.sink
          );
        });
      });
    });
  }

  public async stop(): Promise<void> {
    Object.values(Method).forEach((method) => {
      Object.values(ReqRespEncoding).forEach((encoding) => {
        this.libp2p.unhandle(createRpcProtocol(method, encoding));
      });
    });
    this.controller?.abort();
  }

  public sendResponse(id: RequestId, err: RpcError | null, response?: ResponseBody): void {
    return this.sendResponseStream(
      id,
      err,
      (async function* () {
        if (response != null) {
          yield response;
        }
      })()
    );
  }

  public sendResponseStream(id: RequestId, err: RpcError | null, chunkIter: AsyncIterable<ResponseBody>): void {
    if (err) {
      const config = this.config;
      this.responseListener.emit(
        createResponseEvent(id),
        (async function* () {
          yield {
            requestId: id,
            status: err.status,
            body: encodeP2pErrorMessage(config, err.message || ""),
          };
        })()
      );
      this.logger.verbose("Sent response with error for request " + id);
    } else {
      this.responseListener.emit(
        createResponseEvent(id),
        (async function* () {
          for await (const chunk of chunkIter) {
            yield {status: RpcResponseStatus.SUCCESS, requestId: id, body: chunk};
          }
        })()
      );
      this.logger.verbose("Sent response for request " + id);
    }
  }

  public async status(peerId: PeerId, request: Status): Promise<Status | null> {
    return await sendRequest<Status>(
      {libp2p: this.libp2p, logger: this.logger, config: this.config},
      peerId,
      Method.Status,
      this.peerMetadata.getEncoding(peerId) ?? ReqRespEncoding.SSZ_SNAPPY,
      request,
      this.controller?.signal
    );
  }

  public async goodbye(peerId: PeerId, request: Goodbye): Promise<void> {
    await sendRequest<Goodbye>(
      {libp2p: this.libp2p, logger: this.logger, config: this.config},
      peerId,
      Method.Goodbye,
      this.peerMetadata.getEncoding(peerId) ?? ReqRespEncoding.SSZ_SNAPPY,
      request,
      this.controller?.signal
    );
  }

  public async ping(peerId: PeerId, request: Ping): Promise<Ping | null> {
    return await sendRequest<Ping>(
      {libp2p: this.libp2p, logger: this.logger, config: this.config},
      peerId,
      Method.Ping,
      this.peerMetadata.getEncoding(peerId) ?? ReqRespEncoding.SSZ_SNAPPY,
      request,
      this.controller?.signal
    );
  }

  public async metadata(peerId: PeerId): Promise<Metadata | null> {
    return await sendRequest<Metadata>(
      {libp2p: this.libp2p, logger: this.logger, config: this.config},
      peerId,
      Method.Metadata,
      this.peerMetadata.getEncoding(peerId) ?? ReqRespEncoding.SSZ_SNAPPY,
      undefined,
      this.controller?.signal
    );
  }

  public async beaconBlocksByRange(
    peerId: PeerId,
    request: BeaconBlocksByRangeRequest
  ): Promise<SignedBeaconBlock[] | null> {
    try {
      const result = await sendRequest<SignedBeaconBlock[]>(
        {libp2p: this.libp2p, logger: this.logger, config: this.config},
        peerId,
        Method.BeaconBlocksByRange,
        this.peerMetadata.getEncoding(peerId) ?? ReqRespEncoding.SSZ_SNAPPY,
        request,
        this.controller?.signal
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
      const result = await sendRequest<SignedBeaconBlock[]>(
        {libp2p: this.libp2p, logger: this.logger, config: this.config},
        peerId,
        Method.BeaconBlocksByRoot,
        this.peerMetadata.getEncoding(peerId) ?? ReqRespEncoding.SSZ_SNAPPY,
        request,
        this.controller?.signal
      );
      this.blockProviderScores.update(peerId, RpcScoreEvent.SUCCESS_BLOCK_ROOT);
      return result;
    } catch (e) {
      updateRpcScore(this.blockProviderScores, peerId, e);
      throw e;
    }
  }

  private storePeerEncodingPreference(
    peerId: PeerId,
    method: Method,
    encoding: ReqRespEncoding
  ): (source: AsyncIterable<IValidatedRequestBody>) => AsyncGenerator<IValidatedRequestBody> {
    return (source) => {
      const peerReputations = this.peerMetadata;
      return (async function* () {
        if (method === Method.Status) {
          peerReputations.setEncoding(peerId, encoding);
        }
        yield* source;
      })();
    };
  }

  private handleRpcRequest(
    peerId: PeerId,
    method: Method,
    encoding: ReqRespEncoding
  ): (source: AsyncIterable<IValidatedRequestBody>) => AsyncGenerator<IResponseChunk> {
    const getResponse = this.getResponse;
    const config = this.config;
    return (source) => {
      return (async function* () {
        for await (const request of source) {
          if (!request.isValid) {
            yield {
              requestId: randomRequestId(),
              status: RpcResponseStatus.ERR_INVALID_REQ,
              body: encodeP2pErrorMessage(config, "Invalid Request"),
            };
          } else {
            yield* getResponse(peerId, method, encoding, request.body);
          }
          return;
        }
      })();
    };
  }

  private getResponse = (
    peerId: PeerId,
    method: Method,
    encoding: ReqRespEncoding,
    request?: RequestBody
  ): AsyncIterable<IResponseChunk> => {
    const signal = this.controller?.signal;
    const requestId = randomRequestId();
    this.logger.verbose(`receive ${method} request from ${peerId.toB58String()}`, {requestId, encoding});
    // eslint-disable-next-line
    let responseTimer: NodeJS.Timeout;
    const sourcePromise = new Promise<AsyncIterable<IResponseChunk>>((resolve) => {
      const abortHandler = (): void => clearTimeout(responseTimer);
      const responseListenerFn: ResponseCallbackFn = async (responseIter) => {
        clearTimeout(responseTimer);
        signal?.removeEventListener("abort", abortHandler);
        resolve(responseIter);
      };
      responseTimer = this.responseListener.waitForResponse(this.config, requestId, responseListenerFn);
      signal?.addEventListener("abort", abortHandler, {once: true});
      this.emit("request", peerId, method, requestId, request!);
    });

    return (async function* () {
      yield* await sourcePromise;
    })();
  };
}
