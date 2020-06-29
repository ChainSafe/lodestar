/**
 * @module network
 */
import {EventEmitter} from "events";
import LibP2p from "libp2p";
import {pipe} from "it-pipe";
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
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Method, ReqRespEncoding, RequestId, RESP_TIMEOUT, RpcResponseStatus} from "../constants";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {
  createResponseEvent,
  createRpcProtocol,
  eth2ResponseTimer,
  isRequestOnly,
  isRequestSingleChunk,
  randomRequestId,
} from "./util";
import {IReqResp, ReqEventEmitter, RespEventEmitter, ResponseCallbackFn} from "./interface";
import {INetworkOptions} from "./options";
import PeerId from "peer-id";
import PeerInfo from "peer-info";
import {RpcError} from "./error";
import {eth2RequestDecode, eth2RequestEncode} from "./encoders/request";
import {eth2ResponseDecode, eth2ResponseEncode, encodeP2pErrorMessage} from "./encoders/response";
import {IResponseChunk, IValidatedRequestBody} from "./encoders/interface";
import {IReputationStore} from "../sync/IReputation";

interface IReqEventEmitterClass {
  new(): ReqEventEmitter;
}

interface IRespEventEmitterClass {
  new(): RespEventEmitter;
}

interface IReqRespModules {
  config: IBeaconConfig;
  libp2p: LibP2p;
  logger: ILogger;
  peerReputations: IReputationStore;
}

class ResponseEventListener extends (EventEmitter as IRespEventEmitterClass) {
  public waitForResponse(
    config: IBeaconConfig, requestId: string, responseListener: ResponseCallbackFn): NodeJS.Timeout {
    const responseEvent = createResponseEvent(requestId);
    this.once(responseEvent, responseListener);
    return setTimeout(() => {
      this.removeListener(responseEvent, responseListener);
      const errorGenerator: AsyncGenerator<IResponseChunk> = async function* () {
        yield {
          requestId,
          status: RpcResponseStatus.SERVER_ERROR,
          body: encodeP2pErrorMessage(config, "Timeout processing request"),
        };
      }();
      responseListener(errorGenerator);
    }, RESP_TIMEOUT);
  }
}

export class ReqResp extends (EventEmitter as IReqEventEmitterClass) implements IReqResp {
  private config: IBeaconConfig;
  private libp2p: LibP2p;
  private logger: ILogger;
  private responseListener: ResponseEventListener;
  private peerReputations: IReputationStore;

  public constructor(opts: INetworkOptions, {config, libp2p, peerReputations, logger}: IReqRespModules) {
    super();
    this.config = config;
    this.libp2p = libp2p;
    this.peerReputations = peerReputations;
    this.logger = logger;
    this.responseListener = new ResponseEventListener();
  }
  public async start(): Promise<void> {
    Object.values(Method).forEach((method) => {
      Object.values(ReqRespEncoding).forEach((encoding) => {
        this.libp2p.handle(
          createRpcProtocol(method, encoding),
          async ({connection, stream}) => {
            const peerId = connection.remotePeer;
            pipe(
              stream.source,
              eth2RequestDecode(this.config, this.logger, method, encoding),
              this.storePeerEncodingPreference(peerId, method, encoding),
              this.handleRpcRequest(peerId, method, encoding),
              eth2ResponseEncode(this.config, this.logger, method, encoding),
              stream.sink
            );
          }
        );
      });
    });
  }

  public async stop(): Promise<void> {
    Object.values(Method).forEach((method) => {
      Object.values(ReqRespEncoding).forEach((encoding) => {
        this.libp2p.unhandle(createRpcProtocol(method, encoding));
      });
    });
  }

  public sendResponse(id: RequestId, err: RpcError|null, response?: ResponseBody): void {
    return this.sendResponseStream(id, err, async function *() {
      if(response !== null && response !== undefined) {
        yield response;
      }
    }());
  }

  public sendResponseStream(id: RequestId, err: RpcError|null, chunkIter: AsyncIterable<ResponseBody>): void {
    if(err) {
      const config = this.config;
      this.responseListener.emit(createResponseEvent(id), async function* () {
        yield {
          requestId: id,
          status: err.status,
          body: encodeP2pErrorMessage(config, err.message || ""),
        };
      }());
      this.logger.verbose("Sent response with error for request " + id);
    } else {
      this.responseListener.emit(createResponseEvent(id), async function* () {
        for await (const chunk of chunkIter) {
          yield {status: RpcResponseStatus.SUCCESS, requestId: id, body: chunk};
        }
      }());
      this.logger.verbose("Sent response for request " + id);
    }
  }

  public async status(peerInfo: PeerInfo, request: Status): Promise<Status|null> {
    return await this.sendRequest<Status>(peerInfo, Method.Status, request);
  }

  public async goodbye(peerInfo: PeerInfo, request: Goodbye): Promise<void> {
    await this.sendRequest<Goodbye>(peerInfo, Method.Goodbye, request);
  }

  public async ping(peerInfo: PeerInfo, request: Ping): Promise<Ping|null> {
    return await this.sendRequest<Ping>(peerInfo, Method.Ping, request);
  }

  public async metadata(peerInfo: PeerInfo): Promise<Metadata|null> {
    return await this.sendRequest<Metadata>(peerInfo, Method.Metadata);
  }

  public async beaconBlocksByRange(
    peerInfo: PeerInfo,
    request: BeaconBlocksByRangeRequest
  ): Promise<SignedBeaconBlock[]|null> {
    return await this.sendRequest<SignedBeaconBlock[]>(peerInfo, Method.BeaconBlocksByRange, request);
  }

  public async beaconBlocksByRoot(
    peerInfo: PeerInfo,
    request: BeaconBlocksByRootRequest
  ): Promise<SignedBeaconBlock[]|null> {
    return await this.sendRequest<SignedBeaconBlock[]>(peerInfo, Method.BeaconBlocksByRoot, request);
  }

  private storePeerEncodingPreference(
    peerId: PeerId, method: Method, encoding: ReqRespEncoding
  ): (source: AsyncIterable<IValidatedRequestBody>) => AsyncGenerator<IValidatedRequestBody> {
    return (source) => {
      const peerReputations = this.peerReputations;
      return (async function*() {
        if (method === Method.Status) {
          peerReputations.get(peerId.toB58String()).encoding = encoding;
        }
        yield* source;
      })();
    };
  }

  private handleRpcRequest(
    peerId: PeerId, method: Method, encoding: ReqRespEncoding
  ): ((source: AsyncIterable<IValidatedRequestBody>) => AsyncGenerator<IResponseChunk>) {
    const getResponse = this.getResponse;
    const config = this.config;
    return (source) => {
      return (async function * () {
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
        yield* getResponse(peerId, method, encoding);
      })();
    };
  }

  private getResponse = (
    peerId: PeerId,
    method: Method,
    encoding: ReqRespEncoding,
    request?: RequestBody): AsyncIterable<IResponseChunk> => {
    const requestId = randomRequestId();
    this.logger.verbose(`receive ${method} request from ${peerId.toB58String()}`, {requestId, encoding});
    // eslint-disable-next-line
    let responseTimer: NodeJS.Timeout;
    const sourcePromise = new Promise<AsyncIterable<IResponseChunk>>((resolve) => {
      const responseListenerFn: ResponseCallbackFn = async (responseIter) => {
        clearTimeout(responseTimer);
        resolve(responseIter);
      };
      responseTimer = this.responseListener.waitForResponse(this.config, requestId, responseListenerFn);
      this.emit("request", new PeerInfo(peerId), method, requestId, request);
    });

    return (async function * () {
      yield* await sourcePromise;
    })();
  };

  private async sendRequest<T extends ResponseBody|ResponseBody[]>(
    peerInfo: PeerInfo,
    method: Method,
    body?: RequestBody,
  ): Promise<T|null> {
    const reputaton = this.peerReputations.getFromPeerInfo(peerInfo);
    const encoding = reputaton.encoding || ReqRespEncoding.SSZ_SNAPPY;
    const requestOnly = isRequestOnly(method);
    const requestSingleChunk = isRequestSingleChunk(method);
    const requestId = randomRequestId();
    try {
      return await pipe(
        this.sendRequestStream(peerInfo, method, encoding, requestId, body),
        eth2ResponseTimer(),
        async (source: AsyncIterable<T>): Promise<T | null> => {
          const responses: Array<T> = [];
          for await (const response of source) {
            responses.push(response);
          }
          if (requestSingleChunk && responses.length === 0) {
            // allow empty response for beacon blocks by range/root
            throw `No response returned for method ${method}. request=${requestId}`;
          }
          const finalResponse = requestSingleChunk ? responses[0] : responses;
          this.logger.verbose(`receive ${method} response from ${peerInfo.id.toB58String()}`,{requestId, encoding});
          return requestOnly ? null : finalResponse as T;
        }
      );
    } catch (e) {
      this.logger.error(
        `failed to send request ${requestId} to peer ${peerInfo.id.toB58String()}`, e
      );
    }
  }

  private sendRequestStream<T extends ResponseBody>(
    peerInfo: PeerInfo,
    method: Method,
    encoding: ReqRespEncoding,
    requestId: RequestId,
    body?: RequestBody,
  ): AsyncIterable<T> {
    const {libp2p, config, logger} = this;

    return (async function * () {
      const protocol = createRpcProtocol(method, encoding);
      const {stream} = await libp2p.dialProtocol(peerInfo, protocol) as {stream: Stream};
      logger.verbose(`sending ${method} request to ${peerInfo.id.toB58String()}`, {requestId, encoding});
      yield* pipe(
        (body !== null && body !== undefined) ? [body] : [null],
        eth2RequestEncode(config, logger, method, encoding),
        stream,
        eth2ResponseDecode(config, logger, method, encoding, requestId)
      );
    })();
  }
}
