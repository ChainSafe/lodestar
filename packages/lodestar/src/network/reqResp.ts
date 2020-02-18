/**
 * @module network
 */
import {EventEmitter} from "events";
import LibP2p from "libp2p";
import * as varint from "varint";
import {pipe} from "it-pipe";
import {
  BeaconBlocksByRangeRequest,
  BeaconBlocksByRangeResponse,
  BeaconBlocksByRootRequest,
  BeaconBlocksByRootResponse,
  Goodbye,
  RequestBody,
  ResponseBody, Status, SignedBeaconBlock,
} from "@chainsafe/eth2.0-types";
import {deserialize, serialize} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {
  Encoding,
  ERR_INVALID_REQ,
  ERR_RESP_TIMEOUT,
  MAX_CHUNK_SIZE,
  Method,
  RequestId,
  RESP_TIMEOUT,
} from "../constants";
import {ILogger} from  "@chainsafe/eth2.0-utils/lib/logger";
import {createResponseEvent, createRpcProtocol, randomRequestId, encodeResponseChunk, 
  decodeResponseChunk} from "./util";

import {IReqResp, ReqEventEmitter, RespEventEmitter, ResponseCallbackFn, ResponseChunk} from "./interface";
import {INetworkOptions} from "./options";
import PeerId from "peer-id";
import PeerInfo from "peer-info";

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

    const timer =  setTimeout(() => {
      this.removeListener(responseEvent, responseListener);
      responseListener({err: new Error(ERR_RESP_TIMEOUT)});
    }, RESP_TIMEOUT);
    return timer;
  }
}

export class ReqResp extends (EventEmitter as IReqEventEmitterClass) implements IReqResp {
  private config: IBeaconConfig;
  private libp2p: LibP2p;
  private logger: ILogger;
  private encoding: Encoding;
  private responseListener: ResponseEventListener;

  public constructor(opts: INetworkOptions, {config, libp2p, logger}: IReqRespModules) {
    super();
    this.config = config;
    this.libp2p = libp2p;
    this.logger = logger;
    this.encoding = Encoding.ssz;
    this.responseListener = new ResponseEventListener();
  }
  public async start(): Promise<void> {
    Object.values(Method).forEach((method) => {
      this.libp2p.handle(
        createRpcProtocol(method, this.encoding),
        async ({connection, stream}) => {
          const peerId = connection.remotePeer;
          pipe(
            stream.source,
            // handle request
            async (source: Promise<Buffer | {slice: () => Buffer}>[]) => {
              const result: ResponseChunk[] = [];
              for await (const val of source) {
                const data = Buffer.isBuffer(val) ? val : val.slice();
                const response = await this.handleRequest(peerId, method, data);
                if (!response.err && (method === Method.BeaconBlocksByRange || method === Method.BeaconBlocksByRoot)) {
                  const blocks = response.output as SignedBeaconBlock[];
                  const chunkResponses = blocks.map(block => ({output: block}));
                  result.push(...(chunkResponses));
                } else {
                  result.push(response as ResponseChunk);
                }
              }  
              return result;
            },
            // transform
            (source: Promise<{[Symbol.asyncIterator]: () => AsyncIterator<ResponseChunk>}>) => {
              const config = this.config;
              return (async function * () {
                const sourceVal = await source;
                for await (const val of sourceVal) {
                  // each yield result will be sent to stream.sink immediately
                  yield encodeResponseChunk(config, method, val);
                }
              })();
            },
            stream.sink
          );
        }
      );
    });
  }
  public async stop(): Promise<void> {
    Object.values(Method).forEach((method) => {
      this.libp2p.unhandle(createRpcProtocol(method, this.encoding));
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

  private handleRequest = async (peerId: PeerId, method: Method, data: Buffer):
  Promise<{err?: Error; output?: ResponseBody}> => {
    return new Promise((resolve) => {
      const request = this.decodeRequest(method, data);
      const requestId = randomRequestId();
      this.logger.verbose(`${requestId} - receive ${method} request from ${peerId.toB58String()}`);
      // eslint-disable-next-line
      let responseTimer: NodeJS.Timeout;
      const responseListenerFn = (response: {err?: Error; output?: ResponseBody}): void => {
        clearTimeout(responseTimer);
        resolve(response);
      };
      responseTimer = this.responseListener.waitForResponse(requestId, responseListenerFn);
      this.emit("request", new PeerInfo(peerId), method, requestId, request);
    });
  };

  private encodeRequest(method: Method, body: RequestBody): Buffer {
    let output = Buffer.alloc(0);
    switch (method) {
      case Method.Status:
        output = serialize(this.config.types.Status, body);
        break;
      case Method.Goodbye:
        output = serialize(this.config.types.Goodbye, body);
        break;
      case Method.BeaconBlocksByRange:
        output = serialize(this.config.types.BeaconBlocksByRangeRequest, body);
        break;
      case Method.BeaconBlocksByRoot:
        output = serialize(this.config.types.BeaconBlocksByRootRequest, body);
        break;
    }
    return Buffer.concat([
      Buffer.from(varint.encode(output.length)),
      output,
    ]);
  }

  private decodeRequest(method: Method, data: Buffer): RequestBody {
    const length = varint.decode(data);
    const bytes = varint.decode.bytes;
    if (
      length !== data.length - bytes ||
      length > MAX_CHUNK_SIZE
    ) {
      throw new Error(ERR_INVALID_REQ);
    }
    data = data.slice(bytes);
    switch (method) {
      case Method.Status:
        return deserialize(this.config.types.Status, data);
      case Method.Goodbye:
        return deserialize(this.config.types.Goodbye, data);
      case Method.BeaconBlocksByRange:
        return deserialize(this.config.types.BeaconBlocksByRangeRequest, data);
      case Method.BeaconBlocksByRoot:
        return deserialize(this.config.types.BeaconBlocksByRootRequest, data);
    }
  }
  private decodeResponse(method: Method, data: Buffer): ResponseChunk {
    return decodeResponseChunk(this.config, method, data);
  }
  private async sendRequest<T extends ResponseBody>(
    peerInfo: PeerInfo,
    method: Method,
    body: RequestBody,
    requestOnly?: boolean
  ): Promise<T> {
    const protocol = createRpcProtocol(method, this.encoding);
    const {stream} = await this.libp2p.dialProtocol(peerInfo, protocol) as {stream: Stream};
    return await new Promise((resolve, reject) => {
      this.logger.verbose(`send ${method} request to ${peerInfo.id.toB58String()}`);
      const responseTimer = setTimeout(() => reject(new Error(ERR_RESP_TIMEOUT)), RESP_TIMEOUT);
      pipe(
        [this.encodeRequest(method, body)],
        stream,
        async (source: Promise<Buffer | {slice: () => Buffer}>[]) => {
          try {
            const responses = [];
            for await (const val of source) {
              const data = Buffer.isBuffer(val) ? val : val.slice();
              const response = this.decodeResponse(method, data);
              responses.push(response.output);
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
}
