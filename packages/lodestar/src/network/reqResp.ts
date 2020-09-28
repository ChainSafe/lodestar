/**
 * @module network
 */
import {EventEmitter} from "events";
import LibP2p from "libp2p";
import {pipe} from "it-pipe";
import {Type} from "@chainsafe/ssz";
import {
  BeaconBlocksByRangeRequest,
  BeaconBlocksByRootRequest,
  Goodbye,
  IBeaconSSZTypes,
  Metadata,
  Ping,
  RequestBody,
  ResponseBody,
  SignedBeaconBlock,
  Status,
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {
  Method,
  MethodRequestType,
  ReqRespEncoding,
  RequestId,
  RESP_TIMEOUT,
  RpcResponseStatus,
  TTFB_TIMEOUT,
} from "../constants";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {duplex as abortDuplex} from "abortable-iterator";
import {AbortController} from "abort-controller";
import all from "it-all";
import {
  createResponseEvent,
  createRpcProtocol,
  dialProtocol,
  eth2ResponseTimer,
  isRequestOnly,
  isRequestSingleChunk,
  randomRequestId,
} from "./util";
import {IReqResp, ReqEventEmitter, RespEventEmitter, ResponseCallbackFn} from "./interface";
import {INetworkOptions} from "./options";
import PeerId from "peer-id";
import {RpcError, updateRpcScore} from "./error";
import {eth2RequestDecode, eth2RequestEncode} from "./encoders/request";
import {encodeP2pErrorMessage, eth2ResponseDecode, eth2ResponseEncode} from "./encoders/response";
import {IResponseChunk, IValidatedRequestBody} from "./encoders/interface";
import {IPeerMetadataStore} from "./peers/interface";
import {RpcScoreEvent, IRpcScoreTracker} from "./peers/score";

interface IReqEventEmitterClass {
  new (): ReqEventEmitter;
}

interface IRespEventEmitterClass {
  new (): RespEventEmitter;
}

interface IReqRespModules {
  config: IBeaconConfig;
  libp2p: LibP2p;
  logger: ILogger;
  peerMetadata: IPeerMetadataStore;
  blockProviderScores: IRpcScoreTracker;
}

class ResponseEventListener extends (EventEmitter as IRespEventEmitterClass) {
  public waitForResponse(
    config: IBeaconConfig,
    requestId: string,
    responseListener: ResponseCallbackFn
  ): NodeJS.Timeout {
    const responseEvent = createResponseEvent(requestId);
    this.once(responseEvent, responseListener);
    return setTimeout(() => {
      this.removeListener(responseEvent, responseListener);
      const errorGenerator: AsyncGenerator<IResponseChunk> = (async function* () {
        yield {
          requestId,
          status: RpcResponseStatus.SERVER_ERROR,
          body: encodeP2pErrorMessage(config, "Timeout processing request"),
        };
      })();
      responseListener(errorGenerator);
    }, RESP_TIMEOUT);
  }
}

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
    return await this.sendRequest<Status>(peerId, Method.Status, request);
  }

  public async goodbye(peerId: PeerId, request: Goodbye): Promise<void> {
    await this.sendRequest<Goodbye>(peerId, Method.Goodbye, request);
  }

  public async ping(peerId: PeerId, request: Ping): Promise<Ping | null> {
    return await this.sendRequest<Ping>(peerId, Method.Ping, request);
  }

  public async metadata(peerId: PeerId): Promise<Metadata | null> {
    return await this.sendRequest<Metadata>(peerId, Method.Metadata);
  }

  public async beaconBlocksByRange(
    peerId: PeerId,
    request: BeaconBlocksByRangeRequest
  ): Promise<SignedBeaconBlock[] | null> {
    try {
      const result = await this.sendRequest<SignedBeaconBlock[]>(peerId, Method.BeaconBlocksByRange, request);
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
      const result = await this.sendRequest<SignedBeaconBlock[]>(peerId, Method.BeaconBlocksByRoot, request);
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

  private handleResponses<T extends ResponseBody | ResponseBody[]>(
    peerId: PeerId,
    method: Method,
    encoding: ReqRespEncoding,
    requestId: RequestId,
    requestSingleChunk: boolean,
    requestOnly: boolean,
    body?: RequestBody
  ): (source: AsyncIterable<T>) => Promise<T | null> {
    return async (source) => {
      const responses = await all(source);
      if (requestSingleChunk && responses.length === 0) {
        // allow empty response for beacon blocks by range/root
        this.logger.verbose(`No response returned for method ${method}. request=${requestId}`, {
          peer: peerId.toB58String(),
        });
        return null;
      }
      const finalResponse = requestSingleChunk ? responses[0] : responses;
      this.logger.verbose(`receive ${method} response with ${responses.length} chunks from ${peerId.toB58String()}`, {
        requestId,
        encoding,
        body:
          body != null &&
          (this.config.types[MethodRequestType[method] as keyof IBeaconSSZTypes] as Type<object | unknown>).toJson(
            body
          ),
      });
      return requestOnly ? null : (finalResponse as T);
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

  private async sendRequest<T extends ResponseBody | ResponseBody[]>(
    peerId: PeerId,
    method: Method,
    body?: RequestBody
  ): Promise<T | null> {
    const encoding = this.peerMetadata.getEncoding(peerId) ?? ReqRespEncoding.SSZ_SNAPPY;
    const requestOnly = isRequestOnly(method);
    const requestSingleChunk = isRequestSingleChunk(method);
    const requestId = randomRequestId();
    try {
      return await pipe(
        this.sendRequestStream(peerId, method, encoding, requestId, body),
        this.handleResponses<T>(peerId, method, encoding, requestId, requestSingleChunk, requestOnly, body)
      );
    } catch (e) {
      this.logger.verbose(`failed to send request ${requestId} to peer ${peerId.toB58String()}`, {
        method,
        reason: e.message,
      });
      throw e;
    }
  }

  private sendRequestStream<T extends ResponseBody>(
    peerId: PeerId,
    method: Method,
    encoding: ReqRespEncoding,
    requestId: RequestId,
    body?: RequestBody
  ): AsyncIterable<T> {
    const {libp2p, config, logger} = this;
    const localControllerSignal = this.controller?.signal;
    return (async function* () {
      const protocol = createRpcProtocol(method, encoding);
      logger.verbose(`sending ${method} request to ${peerId.toB58String()}`, {requestId, encoding});
      let conn: {stream: Stream};
      try {
        conn = (await dialProtocol(libp2p, peerId, protocol, TTFB_TIMEOUT, localControllerSignal)) as {stream: Stream};
      } catch (e) {
        throw new Error("Failed to dial peer " + peerId.toB58String() + " (" + e.message + ") protocol: " + protocol);
      }
      logger.verbose(`got stream to ${peerId.toB58String()}`, {requestId, encoding});
      const controller = new AbortController();
      await pipe(body != null ? [body] : [null], eth2RequestEncode(config, logger, method, encoding), conn.stream);
      conn.stream.reset();
      yield* pipe(
        abortDuplex(conn.stream, controller.signal, {returnOnAbort: true}),
        eth2ResponseTimer(controller),
        eth2ResponseDecode(config, logger, method, encoding, requestId, controller)
      );
    })();
  }
}
