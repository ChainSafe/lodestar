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
  ResponseBody, Status,
} from "@chainsafe/eth2.0-types";
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
import {createResponseEvent, createRpcProtocol, randomRequestId,} from "./util";

import {IReqResp, ReqEventEmitter, RespEventEmitter, ResponseCallbackFn} from "./interface";
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
      responseListener(new Error(ERR_RESP_TIMEOUT), null);
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
            (source: Promise<Buffer | {slice: () => Buffer}>[]) => {
              const handleRequest = this.handleRequest;
              return (async function * () { // A generator is async iterable
                for await (const val of source) {
                  const data = Buffer.isBuffer(val) ? val : val.slice();
                  const response = await handleRequest(peerId, method, data);
                  yield response;
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
    this.responseListener.emit(createResponseEvent(id), err, body);
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

  private handleRequest = async (peerId: PeerId, method: Method, data: Buffer): Promise<Buffer> => {
    return new Promise((resolve) => {
      const request = this.decodeRequest(method, data);
      const requestId = randomRequestId();
      this.logger.verbose(`${requestId} - receive ${method} request from ${peerId.toB58String()}`);
      // eslint-disable-next-line
      let responseTimer: NodeJS.Timeout;
      const responseListenerFn = (err: Error|null, output: ResponseBody): void => {
        clearTimeout(responseTimer);
        if (err) resolve(this.encodeResponseError(err));
        this.logger.verbose(`${requestId} - send ${method} response`);
        resolve(this.encodeResponse(method, output));
      };
      responseTimer = this.responseListener.waitForResponse(requestId, responseListenerFn);
      this.emit("request", new PeerInfo(peerId), method, requestId, request);
    });
  };

  private encodeRequest(method: Method, body: RequestBody): Buffer {
    let output: Uint8Array;
    switch (method) {
      case Method.Status:
        output = this.config.types.Status.serialize(body as Status);
        break;
      case Method.Goodbye:
        output = this.config.types.Goodbye.serialize(body as Goodbye);
        break;
      case Method.BeaconBlocksByRange:
        output = this.config.types.BeaconBlocksByRangeRequest.serialize(body as BeaconBlocksByRangeRequest);
        break;
      case Method.BeaconBlocksByRoot:
        output = this.config.types.BeaconBlocksByRootRequest.serialize(body as BeaconBlocksByRootRequest);
        break;
    }
    return Buffer.concat([
      Buffer.from(varint.encode(output.length)),
      output,
    ]);
  }

  private encodeResponse(method: Method, body: ResponseBody): Buffer {
    let output: Uint8Array;
    switch (method) {
      case Method.Status:
        output = this.config.types.Status.serialize(body as Status);
        break;
      case Method.Goodbye:
        output = this.config.types.Goodbye.serialize(body as Goodbye);
        break;
      case Method.BeaconBlocksByRange:
        output = this.config.types.BeaconBlocksByRangeResponse.serialize(body as BeaconBlocksByRangeResponse);
        break;
      case Method.BeaconBlocksByRoot:
        output = this.config.types.BeaconBlocksByRootResponse.serialize(body as BeaconBlocksByRootResponse);
        break;
    }
    return Buffer.concat([
      Buffer.alloc(1),
      Buffer.from(varint.encode(output.length)),
      output,
    ]);
  }
  private encodeResponseError(err: Error): Buffer {
    const b = Buffer.from("c" + err.message);
    b[0] = err.message === ERR_INVALID_REQ ? 1 : 2;
    return b;
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
        return this.config.types.Status.deserialize(data);
      case Method.Goodbye:
        return this.config.types.Goodbye.deserialize(data);
      case Method.BeaconBlocksByRange:
        return this.config.types.BeaconBlocksByRangeRequest.deserialize(data);
      case Method.BeaconBlocksByRoot:
        return this.config.types.BeaconBlocksByRootRequest.deserialize(data);
    }
  }
  private decodeResponse(method: Method, data: Buffer): ResponseBody {
    const code = data[0];
    const length = varint.decode(data, 1);
    const bytes = varint.decode.bytes;
    if (
      length !== data.length - (bytes + 1) ||
      length > MAX_CHUNK_SIZE
    ) {
      throw new Error(ERR_INVALID_REQ);
    }
    data = data.slice(bytes + 1);
    if (code !== 0) {
      throw new Error(data.toString("utf8"));
    }
    switch (method) {
      case Method.Status:
        return this.config.types.Status.deserialize(data);
      case Method.Goodbye:
        return this.config.types.Goodbye.deserialize(data);
      case Method.BeaconBlocksByRange:
        return this.config.types.BeaconBlocksByRangeResponse.deserialize(data);
      case Method.BeaconBlocksByRoot:
        return this.config.types.BeaconBlocksByRootResponse.deserialize(data);
    }
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
          // TODO: support response chunks
          const srcs = [];
          for await (const val of source) {
            const data = Buffer.isBuffer(val) ? val : val.slice();
            srcs.push(data);
          }
          const data = Buffer.concat(srcs);
          clearTimeout(responseTimer);
          this.logger.verbose(`receive ${method} response from ${peerInfo.id.toB58String()}`);
          try {
            resolve(requestOnly? undefined : this.decodeResponse(method, data) as T);
          } catch (e) {
            reject(e);
          }
        }
      );
    });
  }
}
