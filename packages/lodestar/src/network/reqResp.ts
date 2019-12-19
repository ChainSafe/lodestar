/**
 * @module network
 */
import {EventEmitter} from "events";
import LibP2p from "libp2p";
import PeerInfo from "peer-info";
//@ts-ignore
import LibP2pConnection from "interface-connection";
import {promisify} from "es6-promisify";
import pull from "pull-stream";
import * as varint from "varint";
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
import {ILogger} from "../logger";
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
        async (protocol: string, conn: LibP2pConnection) => {
          const peerInfo = (await promisify(conn.getPeerInfo.bind(conn))()) as PeerInfo;
          pull(
            conn,
            this.handleRequest(peerInfo, method, method === Method.Goodbye),
            conn,
          );
        });
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

  /**
   * Return a "through" pull-stream that processes a request and waits for/returns a response
   */
  private handleRequest = (peerInfo: PeerInfo, method: Method, requestOnly?: boolean) => {
    //@ts-ignore
    return (read) => {
      //@ts-ignore
      return (end, cb) => {
        //@ts-ignore
        read(end, (end, data) => {
          if (end) return cb(end);
          try {
            const request = this.decodeRequest(method, data);
            const requestId = randomRequestId();
            this.logger.verbose(`${requestId} - receive ${method} request from ${peerInfo.id.toB58String()}`);
            if (!requestOnly) {
              const responseEvent = createResponseEvent(requestId);
              // eslint-disable-next-line
              let responseListener: any;
              const responseTimer = setTimeout(() => {
                this.logger.verbose(`${requestId} - send ${method} response timeout`);
                // @ts-ignore
                this.removeListener(responseEvent, responseListener);
                cb(null, this.encodeResponseError(new Error(ERR_RESP_TIMEOUT)));
              }, RESP_TIMEOUT);
              responseListener = (err: Error|null, output: ResponseBody): void => {
                // @ts-ignore
                this.removeListener(responseEvent, responseListener);
                clearTimeout(responseTimer);
                if (err) return cb(null, this.encodeResponseError(err));
                cb(null, this.encodeResponse(method, output));
                this.logger.verbose(`${requestId} - send ${method} response`);
              };
              // @ts-ignore
              this.once(responseEvent, responseListener);
            } else {
              cb(true);
            }
            this.emit("request", peerInfo, method, requestId, request);
          } catch (e) {
            if (!requestOnly) {
              cb(null, this.encodeResponseError(e));
            }
          }
        });
      };
    };
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
    peerInfo: PeerInfo,
    method: Method,
    body: RequestBody,
    requestOnly?: boolean
  ): Promise<T> {
    const protocol = createRpcProtocol(method, this.encoding);
    return await new Promise((resolve, reject) => {
      this.libp2p.dialProtocol(peerInfo, protocol, (err, conn): unknown => {
        if (err) {
          return reject(err);
        }
        this.logger.verbose(`send ${method} request to ${peerInfo.id.toB58String()}`);
        // @ts-ignore
        const responseTimer = setTimeout(() => reject(new Error(ERR_RESP_TIMEOUT)), RESP_TIMEOUT);
        // pull-stream through that will resolve after the request is sent
        // @ts-ignore
        const requestOnlyThrough =(read): unknown => {
          // @ts-ignore
          return (end, cb) => {
            // @ts-ignore
            read(end, (end, data) => {
              if (end) {
                cb(end);
                clearTimeout(responseTimer);
                return resolve();
              }
              cb(null, data);
            });
          };
        };
        // @ts-ignore
        pull(
          pull.values([this.encodeRequest(method, body)]),
          requestOnly && requestOnlyThrough,
          conn,
          pull.drain((data) => {
            clearTimeout(responseTimer);
            this.logger.verbose(`receive ${method} response from ${peerInfo.id.toB58String()}`);
            try {
              resolve(this.decodeResponse(method, data) as T);
            } catch (e) {
              reject(e);
            }
          }),
        );
      });
    });
  }
}
