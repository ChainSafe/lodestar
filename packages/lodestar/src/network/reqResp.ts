/**
 * @module network
 */
import {EventEmitter} from "events";
import LibP2p from "libp2p";
import {pipe} from "it-pipe";
import {
  BeaconBlocksByRangeRequest,
  BeaconBlocksByRangeResponse,
  BeaconBlocksByRootRequest,
  BeaconBlocksByRootResponse,
  Goodbye,
  RequestBody,
  ResponseBody,
  SignedBeaconBlock,
  Status,
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ERR_RESP_TIMEOUT, Method, ReqRespEncoding, RequestId, RESP_TIMEOUT,} from "../constants";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {createResponseEvent, createRpcProtocol, randomRequestId} from "./util";
import {IReqResp, ReqEventEmitter, RespEventEmitter, Response, ResponseCallbackFn, ResponseChunk} from "./interface";
import {INetworkOptions} from "./options";
import PeerId from "peer-id";
import PeerInfo from "peer-info";
// eslint-disable-next-line import/no-extraneous-dependencies
import BufferList from "bl";
import {ReqRespEncoder} from "./encoder";

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
      responseListener({err: new Error(ERR_RESP_TIMEOUT)});
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

  public sendResponse(id: RequestId, err: Error, body: ResponseBody): void {
    this.responseListener.emit(createResponseEvent(id), {err, output: body});
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
  ): Promise<BeaconBlocksByRangeResponse> {
    return await this.sendRequest<BeaconBlocksByRangeResponse>(peerInfo, Method.BeaconBlocksByRange, request);
  }
  public async beaconBlocksByRoot(
    peerInfo: PeerInfo,
    request: BeaconBlocksByRootRequest
  ): Promise<BeaconBlocksByRootResponse> {
    return await this.sendRequest<BeaconBlocksByRootResponse>(peerInfo, Method.BeaconBlocksByRoot, request);
  }

  private handleRpcRequests(
    peerId: PeerId, method: Method
  ): ((source: AsyncIterable<Buffer|BufferList>) => AsyncGenerator<Partial<Response>|ResponseChunk>) {
    const getResponse = this.getResponse;
    return (source: AsyncIterable<Buffer|BufferList>) => {
      return (async function * () {
        for await (const val of source) {
          const data = Buffer.isBuffer(val) ? val : val.slice();
          const response = await getResponse(peerId, method, data);
          if (!response.err && (method === Method.BeaconBlocksByRange || method === Method.BeaconBlocksByRoot)) {
            const blocks = response.output as SignedBeaconBlock[];
            yield* blocks.map(block => ({output: block}));
          } else if(!response.err && !response.output) {
            yield {err: new Error("Missing response data")};
          } else {
            yield response;
          }
        }
      })();
    };
  }

  private getResponse = async (peerId: PeerId, method: Method, data: Buffer):
  Promise<Partial<Response>> => {
    return new Promise((resolve) => {
      const request = this.encoder.decodeRequest(method, data);
      const requestId = randomRequestId();
      this.logger.verbose(`${requestId} - receive ${method} request from ${peerId.toB58String()}`);
      // eslint-disable-next-line
      let responseTimer: NodeJS.Timeout;
      const responseListenerFn: ResponseCallbackFn = (response) => {
        clearTimeout(responseTimer);
        resolve(response);
      };
      responseTimer = this.responseListener.waitForResponse(requestId, responseListenerFn);
      this.emit("request", new PeerInfo(peerId), method, requestId, request);
    });
  };

  private async sendRequest<T extends ResponseBody>(
    peerInfo: PeerInfo,
    method: Method,
    body: RequestBody,
    requestOnly?: boolean
  ): Promise<T> {
    const protocol = createRpcProtocol(method, this.encoder.encoding);
    const {stream} = await this.libp2p.dialProtocol(peerInfo, protocol) as {stream: Stream};
    return await new Promise((resolve, reject) => {
      this.logger.verbose(`send ${method} request to ${peerInfo.id.toB58String()}`);
      const responseTimer = setTimeout(() => reject(new Error(ERR_RESP_TIMEOUT)), RESP_TIMEOUT);
      pipe(
        [this.encoder.encodeRequest(method, body)],
        stream,
        this.encoder.decodeResponse(method),
        async (source: AsyncIterable<ResponseBody>) => {
          try {
            const  responses = [];
            for await (const response of source) {
              responses.push(response);
            }
            if (!requestOnly && responses.length === 0) {
              reject(`No response returned for method ${method}`);
              return;
            }
            const finalResponse = (method === Method.Status) ? responses[0] : responses;
            clearTimeout(responseTimer);
            this.logger.verbose(`receive ${method} response from ${peerInfo.id.toB58String()}`);
            resolve(requestOnly? undefined : finalResponse as T);
          } catch (e) {
            reject(e);
          }
        }
      );
    });
  }

  private
}
