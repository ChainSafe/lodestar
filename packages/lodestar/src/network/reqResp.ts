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
  randomRequestId
} from "./util";
import {IReqResp, ReqEventEmitter, RespEventEmitter, ResponseCallbackFn} from "./interface";
import {INetworkOptions} from "./options";
import PeerId from "peer-id";
import PeerInfo from "peer-info";
import {RpcError} from "./error";
import {eth2RequestDecode, eth2RequestEncode} from "./encoders/request";
import {eth2ResponseDecode, eth2ResponseEncode} from "./encoders/response";
import {IResponseChunk} from "./encoders/interface";
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
  public waitForResponse(requestId: string, responseListener: ResponseCallbackFn): NodeJS.Timeout {
    const responseEvent = createResponseEvent(requestId);
    this.once(responseEvent, responseListener);

    return setTimeout(() => {
      this.removeListener(responseEvent, responseListener);
      const errorGenerator: AsyncGenerator<IResponseChunk> = async function* () {
        yield {status: RpcResponseStatus.ERR_RESP_TIMEOUT};
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
              this.handleRpcRequest(peerId, method),
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
      this.responseListener.emit(createResponseEvent(id), async function* () {
        yield {status: err.status};
      }());
      this.logger.verbose("Sent response with error for request " + id);
    } else {
      this.responseListener.emit(createResponseEvent(id), async function* () {
        for await (const chunk of chunkIter) {
          yield {status: RpcResponseStatus.SUCCESS, body: chunk};
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
  ): (source: AsyncIterable<RequestBody>) => AsyncGenerator<RequestBody|null> {
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
    peerId: PeerId, method: Method
  ): ((source: AsyncIterable<RequestBody|null>) => AsyncGenerator<IResponseChunk>) {
    const getResponse = this.getResponse;
    return (source) => {
      return (async function * () {
        for await (const request of source) {
          yield* getResponse(peerId, method, request);
          return;
        }
      })();
    };
  }

  private getResponse = (
    peerId: PeerId,
    method: Method,
    request?: RequestBody): AsyncIterable<IResponseChunk> => {
    const requestId = randomRequestId();
    this.logger.verbose(`${requestId} - receive ${method} request from ${peerId.toB58String()}`);
    // eslint-disable-next-line
    let responseTimer: NodeJS.Timeout;
    const sourcePromise = new Promise<AsyncIterable<IResponseChunk>>((resolve) => {
      const responseListenerFn: ResponseCallbackFn = async (responseIter) => {
        clearTimeout(responseTimer);
        resolve(responseIter);
      };
      responseTimer = this.responseListener.waitForResponse(requestId, responseListenerFn);
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
    try {
      return await pipe(
        this.sendRequestStream(peerInfo, method, encoding, body),
        eth2ResponseTimer(),
        async (source: AsyncIterable<T>): Promise<T | null> => {
          const responses: Array<T> = [];
          for await (const response of source) {
            responses.push(response);
          }
          if (requestSingleChunk && responses.length === 0) {
            // allow empty response for beacon blocks by range/root
            throw `No response returned for method ${method}`;
          }
          const finalResponse = requestSingleChunk ? responses[0] : responses;
          this.logger.verbose(`receive ${method} response from ${peerInfo.id.toB58String()}`);
          return requestOnly ? null : finalResponse as T;
        }
      );
    } catch (e) {
      this.logger.error(
        `failed to send ${method}(${encoding}) to peer ${peerInfo.id.toB58String()}.`, e
      );
    }
  }

  private sendRequestStream<T extends ResponseBody>(
    peerInfo: PeerInfo,
    method: Method,
    encoding: ReqRespEncoding,
    body?: RequestBody,
  ): AsyncIterable<T> {
    const {libp2p, config, logger} = this;

    return (async function * () {
      const protocol = createRpcProtocol(method, encoding);
      const {stream} = await libp2p.dialProtocol(peerInfo, protocol) as {stream: Stream};
      logger.verbose(`sending ${method} with encoding=${encoding} request to ${peerInfo.id.toB58String()}`);
      yield* pipe(
        (body !== null && body !== undefined) ? [body] : [null],
        eth2RequestEncode(config, logger, method, encoding),
        stream,
        eth2ResponseDecode(config, logger, method, encoding)
      );
    })();
  }
}
