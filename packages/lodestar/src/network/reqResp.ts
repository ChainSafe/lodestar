/**
 * @module network
 */
import {EventEmitter} from "events";
import LibP2p from "libp2p";
//@ts-ignore
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
import {createResponseEvent, createRpcProtocol, randomRequestId,} from "./util";

import {IReqResp, ReqRespEventEmitter} from "./interface";
import {INetworkOptions} from "./options";

interface IReqRespEventEmitterClass {
  new(): ReqRespEventEmitter;
}

interface IReqRespModules {
  config: IBeaconConfig;
  libp2p: LibP2p;
  logger: ILogger;
}

export class ReqResp extends (EventEmitter as IReqRespEventEmitterClass) implements IReqResp {
  private config: IBeaconConfig;
  private libp2p: LibP2p;
  private logger: ILogger;
  private encoding: Encoding;

  public constructor(opts: INetworkOptions, {config, libp2p, logger}: IReqRespModules) {
    super();
    this.config = config;
    this.libp2p = libp2p;
    this.logger = logger;
    this.encoding = Encoding.ssz;
  }
  public async start(): Promise<void> {
    Object.values(Method).forEach((method) => {
      this.libp2p.handle(
        createRpcProtocol(method, this.encoding),
        // @ts-ignore
        async ({connection, stream}) => {
          const peerId = connection.remotePeer;
          // @ts-ignore
          pipe(
            stream.source,
            // @ts-ignore
            (source) => {
              // @ts-ignore
              const self = this;
              return (async function * () { // A generator is async iterable
                for await (const val of source) {
                  const response = await self.handleRequest(peerId, method, val.slice(0, val.length));
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
    // @ts-ignore
    this.emit(createResponseEvent(id), err, body);
  }
  public async status(peerId: PeerId, request: Status): Promise<Status> {
    return await this.sendRequest<Status>(peerId, Method.Status, request);
  }
  public async goodbye(peerId: PeerId, request: Goodbye): Promise<void> {
    await this.sendRequest<Goodbye>(peerId, Method.Goodbye, request);
  }
  public async beaconBlocksByRange(
    peerId: PeerId,
    request: BeaconBlocksByRangeRequest
  ): Promise<BeaconBlocksByRangeResponse> {
    return await this.sendRequest<BeaconBlocksByRangeResponse>(peerId, Method.BeaconBlocksByRange, request);
  }
  public async beaconBlocksByRoot(
    peerId: PeerId,
    request: BeaconBlocksByRootRequest
  ): Promise<BeaconBlocksByRootResponse> {
    return await this.sendRequest<BeaconBlocksByRootResponse>(peerId, Method.BeaconBlocksByRoot, request);
  }

  private handleRequest = async (peerId: PeerId, method: Method, data: Buffer): Promise<Buffer> => {
    return new Promise((resolve) => {
      const request = this.decodeRequest(method, data);
      const requestId = randomRequestId();
      this.logger.verbose(`${requestId} - receive ${method} request from ${peerId.toB58String()}`);
      const responseEvent = createResponseEvent(requestId);
      // eslint-disable-next-line
      let responseListener: any;
      const responseTimer = setTimeout(() => {
        this.logger.verbose(`${requestId} - send ${method} response timeout`);
        // @ts-ignore
        this.removeListener(responseEvent, responseListener);
        resolve(this.encodeResponseError(new Error(ERR_RESP_TIMEOUT)));
      }, RESP_TIMEOUT);
      responseListener = (err: Error|null, output: ResponseBody): void => {
        // @ts-ignore
        this.removeListener(responseEvent, responseListener);
        clearTimeout(responseTimer);
        if (err) resolve(this.encodeResponseError(err));
        this.logger.verbose(`${requestId} - send ${method} response`);
        resolve(this.encodeResponse(method, output));
      };
      // @ts-ignore
      this.once(responseEvent, responseListener);
      this.emit("request", peerId, method, requestId, request);
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

  private encodeResponse(method: Method, body: ResponseBody): Buffer {
    let output= Buffer.alloc(0);
    switch (method) {
      case Method.Status:
        output = serialize(this.config.types.Status, body);
        break;
      case Method.Goodbye:
        output = serialize(this.config.types.Goodbye, body);
        break;
      case Method.BeaconBlocksByRange:
        output = serialize(this.config.types.BeaconBlocksByRangeResponse, body);
        break;
      case Method.BeaconBlocksByRoot:
        output = serialize(this.config.types.BeaconBlocksByRootResponse, body);
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
        return deserialize(this.config.types.Status, data);
      case Method.Goodbye:
        return deserialize(this.config.types.Goodbye, data);
      case Method.BeaconBlocksByRange:
        return deserialize(this.config.types.BeaconBlocksByRangeRequest, data);
      case Method.BeaconBlocksByRoot:
        return deserialize(this.config.types.BeaconBlocksByRootRequest, data);
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
        return deserialize(this.config.types.Status, data);
      case Method.Goodbye:
        return deserialize(this.config.types.Goodbye, data);
      case Method.BeaconBlocksByRange:
        return deserialize(this.config.types.BeaconBlocksByRangeResponse, data);
      case Method.BeaconBlocksByRoot:
        return deserialize(this.config.types.BeaconBlocksByRootResponse, data);
    }
  }
  private async sendRequest<T extends ResponseBody>(
    peerId: PeerId,
    method: Method,
    body: RequestBody
  ): Promise<T> {
    const protocol = createRpcProtocol(method, this.encoding);
    // @ts-ignore
    const {stream} = await this.libp2p.dialProtocol(peerId, protocol);
    return await new Promise((resolve, reject) => {
      this.logger.verbose(`send ${method} request to ${peerId.toB58String()}`);
      const responseTimer = setTimeout(() => reject(new Error(ERR_RESP_TIMEOUT)), RESP_TIMEOUT);
      // @ts-ignore
      pipe(
        [this.encodeRequest(method, body)],
        stream,
        // @ts-ignore
        async (source) => {
          // TODO: support response chunks
          const srcs = [];
          for await (const data of source) {
            // data is BufferList, need to convert to Buffer
            srcs.push(data.slice(0, data.length));
          }
          const data = Buffer.concat(srcs);
          clearTimeout(responseTimer);
          this.logger.verbose(`receive ${method} response from ${peerId.toB58String()}`);
          try {
            resolve(this.decodeResponse(method, data) as T);
          } catch (e) {
            reject(e);
          }
        }
      );
    });
  }
}
