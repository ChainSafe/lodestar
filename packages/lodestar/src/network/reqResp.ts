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
  RequestBody,
  ResponseBody,
  SignedBeaconBlock,
  Status,
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Method, ReqRespEncoding, RequestId, RESP_TIMEOUT, RpcErrorCode, TTFB_TIMEOUT,} from "../constants";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {createResponseEvent, createRpcProtocol, randomRequestId} from "./util";
import {IReqResp, ReqEventEmitter, RespEventEmitter, ResponseCallbackFn, ResponseChunk} from "./interface";
import {INetworkOptions} from "./options";
import PeerId from "peer-id";
import PeerInfo from "peer-info";
// eslint-disable-next-line import/no-extraneous-dependencies
import BufferList from "bl";
import {ReqRespEncoder} from "./encoder";
import {RpcError} from "./error";

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
}

class ResponseEventListener extends (EventEmitter as IRespEventEmitterClass) {
  public waitForResponse(requestId: string, responseListener: ResponseCallbackFn): NodeJS.Timeout {
    const responseEvent = createResponseEvent(requestId);
    this.once(responseEvent, responseListener);

    return setTimeout(() => {
      this.removeListener(responseEvent, responseListener);
      const errorGenerator: AsyncGenerator<ResponseChunk> = async function* () {
        yield {err: new RpcError(RpcErrorCode.ERR_RESP_TIMEOUT)};
      }();
      responseListener(errorGenerator);
    }, RESP_TIMEOUT);
  }
}

export class ReqResp extends (EventEmitter as IReqEventEmitterClass) implements IReqResp {
  private config: IBeaconConfig;
  private libp2p: LibP2p;
  private logger: ILogger;
  private encoder: ReqRespEncoder;
  private responseListener: ResponseEventListener;

  public constructor(opts: INetworkOptions, {config, libp2p, logger}: IReqRespModules) {
    super();
    this.config = config;
    this.libp2p = libp2p;
    this.logger = logger;
    this.encoder = new ReqRespEncoder(config, ReqRespEncoding.SSZ);
    this.responseListener = new ResponseEventListener();
  }
  public async start(): Promise<void> {
    Object.values(Method).forEach((method) => {
      this.libp2p.handle(
        createRpcProtocol(method, this.encoder.encoding),
        async ({connection, stream}) => {
          const peerId = connection.remotePeer;
          pipe(
            stream.source,
            this.handleRpcRequests(peerId, method),
            this.encoder.encodeResponse(method),
            stream.sink
          );
        }
      );
    });
  }

  public async stop(): Promise<void> {
    Object.values(Method).forEach((method) => {
      this.libp2p.unhandle(createRpcProtocol(method, this.encoder.encoding));
    });
  }

  public sendResponse(id: RequestId, err: RpcError, chunks: ResponseBody[]): void {
    if(err) {
      this.responseListener.emit(createResponseEvent(id), async function* () {
        yield {err};
      }());
    } else {
      const asyncIter = async function* () {
        for (const chunk of chunks) {
          yield {output: chunk};
        }
      }();
      this.responseListener.emit(createResponseEvent(id), asyncIter);
    }
  }

  public sendResponseStream(id: RequestId, err: RpcError, chunkIter: AsyncIterable<ResponseBody>): void {
    if(err) {
      this.responseListener.emit(createResponseEvent(id), async function* () {
        yield {err: err};
      }());
    } else {
      const asyncIter = async function* () {
        for await (const chunk of chunkIter) {
          yield {output: chunk};
        }
      }();
      this.responseListener.emit(createResponseEvent(id), asyncIter);
    }
  }

  public async status(peerInfo: PeerInfo, request: Status): Promise<Status> {
    return await this.sendRequest<Status>(peerInfo, Method.Status, request);
  }
  public async goodbye(peerInfo: PeerInfo, request: Goodbye): Promise<void> {
    await this.sendRequest<Goodbye>(peerInfo, Method.Goodbye, request, true);
  }
  public async beaconBlocksByRange(
    peerInfo: PeerInfo,
    request: BeaconBlocksByRangeRequest
  ): Promise<SignedBeaconBlock[]> {
    return await this.sendRequest<SignedBeaconBlock[]>(peerInfo, Method.BeaconBlocksByRange, request);
  }
  public async beaconBlocksByRoot(
    peerInfo: PeerInfo,
    request: BeaconBlocksByRootRequest
  ): Promise<SignedBeaconBlock[]> {
    return await this.sendRequest<SignedBeaconBlock[]>(peerInfo, Method.BeaconBlocksByRoot, request);
  }

  private handleRpcRequests(
    peerId: PeerId, method: Method
  ): ((source: AsyncIterable<Buffer|BufferList>) => AsyncGenerator<ResponseChunk>) {
    const getResponse = this.getResponse;
    return (source: AsyncIterable<Buffer|BufferList>) => {
      return (async function * () {
        for await (const val of source) {
          const data = Buffer.isBuffer(val) ? val : val.slice();
          yield* getResponse(peerId, method, data);
        }
      })();
    };
  }

  private getResponse = (peerId: PeerId, method: Method, data: Buffer): AsyncIterable<ResponseChunk> => {
    const request = this.encoder.decodeRequest(method, data);
    const requestId = randomRequestId();
    this.logger.verbose(`${requestId} - receive ${method} request from ${peerId.toB58String()}`);
    // eslint-disable-next-line
    let responseTimer: NodeJS.Timeout;
    const promise = new Promise<AsyncIterable<ResponseChunk>>((resolve) => {
      const responseListenerFn: ResponseCallbackFn = async (responseIter: AsyncIterable<ResponseChunk>) => {
        clearTimeout(responseTimer);
        resolve(responseIter);
      };
      responseTimer = this.responseListener.waitForResponse(requestId, responseListenerFn);
      this.emit("request", new PeerInfo(peerId), method, requestId, request);
    });
    
    return (async function * () {
      const responseIter = await promise;
      yield* responseIter;
    })();
  };

  private async sendRequest<T extends ResponseBody|ResponseBody[]>(
    peerInfo: PeerInfo,
    method: Method,
    body: RequestBody,
    requestOnly?: boolean
  ): Promise<T> {
    return await new Promise((resolve, reject) => {
      this.logger.verbose(`send ${method} request to ${peerInfo.id.toB58String()}`);
      let responseTimer = setTimeout(() => reject(new RpcError(RpcErrorCode.ERR_RESP_TIMEOUT)), TTFB_TIMEOUT);
      const renewTimer = (): void => {
        clearTimeout(responseTimer);
        responseTimer = setTimeout(() => reject(new RpcError(RpcErrorCode.ERR_RESP_TIMEOUT)), RESP_TIMEOUT);
      };
      const cancelTimer = (): void => {
        clearTimeout(responseTimer);
      };
      try {
        const responses: Array<T> = [];
        pipe(this.sendRequestStream(peerInfo, method, body),
          async (source: AsyncIterable<T>): Promise<void> => {
            for await (const response of source) {
              renewTimer();
              responses.push(response);
            }
            cancelTimer();
            if (!requestOnly && responses.length === 0) {
              reject(`No response returned for method ${method}`);
              return;
            }
            const finalResponse = (method === Method.Status) ? responses[0] : responses;
            this.logger.verbose(`receive ${method} response from ${peerInfo.id.toB58String()}`);
            resolve(requestOnly? undefined : finalResponse as T);
          });
      } catch (e) {
        reject(e);
      }
    });
  }

  private sendRequestStream<T extends ResponseBody|ResponseBody[]>(
    peerInfo: PeerInfo,
    method: Method,
    body: RequestBody,
  ): AsyncIterable<T> {
    const {encoder, libp2p, logger} = this;
    
    return (async function * () {
      const protocol = createRpcProtocol(method, encoder.encoding);
      const {stream} = await libp2p.dialProtocol(peerInfo, protocol) as {stream: Stream};
      const promise = new Promise<AsyncIterable<T>>((resolve) => {
        logger.verbose(`send ${method} request to ${peerInfo.id.toB58String()}`);
        pipe(
          [encoder.encodeRequest(method, body)],
          stream,
          encoder.decodeResponse(method),
          (source: AsyncIterable<T>) => {
            resolve(source);
          }
        );
      });
      yield* await promise;
    })();
  }
}
