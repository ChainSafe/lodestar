/**
 * @module network
 */
import {EventEmitter} from "events";
import LibP2p from "libp2p";
import LibP2pConnection from "interface-connection";
import promisify from "promisify-es6";
import pull from "pull-stream";
import varint from "varint";
import StrictEventEmitter from "strict-event-emitter-types";
import {RequestBody, ResponseBody, Hello, BeaconBlocksResponse, BeaconBlocksRequest, Goodbye, RecentBeaconBlocksResponse, RecentBeaconBlocksRequest} from "@chainsafe/eth2.0-types";
import {serialize, deserialize} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {
  Encoding, Method, RequestId,
  ERR_INVALID_REQ, ERR_RESP_TIMEOUT,
  REQ_RESP_MAX_SIZE, TTFB_TIMEOUT, RESP_TIMEOUT,
} from "../constants";
import {ILogger} from "../logger";
import {
  createRpcProtocol,
  createResponseEvent,
  randomRequestId,
} from "./util";

import {IReqResp, ReqRespEventEmitter} from "./interface";

interface ReqRespEventEmitterClass {
  new(): ReqRespEventEmitter;
}

interface ReqRespModules {
  config: IBeaconConfig;
  libp2p: any;
  logger: ILogger;
}

export class ReqResp extends (EventEmitter as ReqRespEventEmitterClass) implements IReqResp {
  private config: IBeaconConfig;
  private libp2p: LibP2p;
  private logger: ILogger;
  private encoding: Encoding;

  public constructor(opts, {config, libp2p, logger}: ReqRespModules) {
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
          const peerInfo = await promisify(conn.getPeerInfo.bind(conn))();
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
  /**
   * Return a "through" pull-stream that processes a request and waits for/returns a response
   */
  private handleRequest = (peerInfo: PeerInfo, method: Method, requestOnly?: boolean) => {
    return (read) => {
      return (end, cb) => {
        read(end, (end, data) => {
          if (end) return cb(end);
          try {
            const request = this.decodeRequest(method, data);
            const requestId = randomRequestId();
            this.emit("request", peerInfo, method, requestId, request);
            this.logger.debug("request", {
              peer: peerInfo.id.toB58String(),
              method,
              requestId,
            });
            if (!requestOnly) {
              const responseEvent = createResponseEvent(requestId);
              let responseListener;
              const responseTimer = setTimeout(() => {
                this.logger.debug("response timeout", {
                  method,
                  requestId,
                });
                // @ts-ignore
                this.removeListener(responseEvent, responseListener);
                cb(null, this.encodeResponseError(new Error(ERR_RESP_TIMEOUT)));
              }, RESP_TIMEOUT);
              responseListener = (err, output): void => {
                this.logger.debug("response", {
                  method,
                  requestId,
                });
                // @ts-ignore
                this.removeListener(responseEvent, responseListener);
                clearTimeout(responseTimer);
                if (err) return cb(null, this.encodeResponseError(err));
                cb(null, this.encodeResponse(method, output));
              };
              // @ts-ignore
              this.once(responseEvent, responseListener);
            } else {
              cb(true);
            }
          } catch (e) {
            if (!requestOnly) {
              cb(null, this.encodeResponseError(e));
            }
          }
        });
      };
    };
  }
  private encodeRequest(method: Method, body: RequestBody): Buffer {
    let output: Buffer;
    switch (method) {
      case Method.Hello:
        output = serialize(body, this.config.types.Hello);
        break;
      case Method.Goodbye:
        output = serialize(body, this.config.types.Goodbye);
        break;
      case Method.BeaconBlocks:
        output = serialize(body, this.config.types.BeaconBlocksRequest);
        break;
      case Method.RecentBeaconBlocks:
        output = serialize(body, this.config.types.RecentBeaconBlocksRequest);
        break;
    }
    return Buffer.concat([
      Buffer.from(varint.encode(output.length)),
      output,
    ]);
  }
  private encodeResponse(method: Method, body: ResponseBody): Buffer {
    let output: Buffer;
    switch (method) {
      case Method.Hello:
        output = serialize(body, this.config.types.Hello);
        break;
      case Method.Goodbye:
        output = serialize(body, this.config.types.Goodbye);
        break;
      case Method.BeaconBlocks:
        output = serialize(body, this.config.types.BeaconBlocksResponse);
        break;
      case Method.RecentBeaconBlocks:
        output = serialize(body, this.config.types.RecentBeaconBlocksResponse);
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
      length > REQ_RESP_MAX_SIZE
    ) {
      throw new Error(ERR_INVALID_REQ);
    }
    data = data.slice(bytes);
    switch (method) {
      case Method.Hello:
        return deserialize(data, this.config.types.Hello);
      case Method.Goodbye:
        return deserialize(data, this.config.types.Goodbye);
      case Method.BeaconBlocks:
        return deserialize(data, this.config.types.BeaconBlocksRequest);
      case Method.RecentBeaconBlocks:
        return deserialize(data, this.config.types.RecentBeaconBlocksRequest);
    }
  }
  private decodeResponse(method: Method, data: Buffer): ResponseBody {
    const code = data[0];
    const length = varint.decode(data, 1);
    const bytes = varint.decode.bytes;
    if (
      length !== data.length - (bytes + 1) ||
      length > REQ_RESP_MAX_SIZE
    ) {
      throw new Error(ERR_INVALID_REQ);
    }
    data = data.slice(bytes + 1);
    if (code !== 0) {
      throw new Error(data.toString("utf8"));
    }
    switch (method) {
      case Method.Hello:
        return deserialize(data, this.config.types.Hello);
      case Method.Goodbye:
        return deserialize(data, this.config.types.Goodbye);
      case Method.BeaconBlocks:
        return deserialize(data, this.config.types.BeaconBlocksRequest);
      case Method.RecentBeaconBlocks:
        return deserialize(data, this.config.types.RecentBeaconBlocksRequest);
    }
  }
  private async sendRequest<T extends ResponseBody>(peerInfo: PeerInfo, method: Method, body: RequestBody, requestOnly?: boolean): Promise<T> {
    const protocol = createRpcProtocol(method, this.encoding);
    return await new Promise((resolve, reject) => {
      this.libp2p.dialProtocol(peerInfo, protocol, (err, conn) => {
        if (err) {
          return reject(err);
        }
        // @ts-ignore
        const responseTimer = setTimeout(() => reject(new Error(ERR_RESP_TIMEOUT)), RESP_TIMEOUT);
        // pull-stream through that will resolve after the request is sent
        const requestOnlyThrough =(read) => {
          return (end, cb) => {
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
  public sendResponse(id: RequestId, err: Error, body: ResponseBody): void {
    // @ts-ignore
    this.emit(`response ${id}`, err, body);
  }
  public async hello(peerInfo: PeerInfo, request: Hello): Promise<Hello> {
    return await this.sendRequest<Hello>(peerInfo, Method.Hello, request);
  }
  public async goodbye(peerInfo: PeerInfo, request: Goodbye): Promise<void> {
    await this.sendRequest<Goodbye>(peerInfo, Method.Goodbye, request, true);
  }
  public async beaconBlocks(peerInfo: PeerInfo, request: BeaconBlocksRequest): Promise<BeaconBlocksResponse> {
    return await this.sendRequest<BeaconBlocksResponse>(peerInfo, Method.BeaconBlocks, request);
  }
  public async recentBeaconBlocks(peerInfo: PeerInfo, request: RecentBeaconBlocksRequest): Promise<RecentBeaconBlocksResponse> {
    return await this.sendRequest<RecentBeaconBlocksResponse>(peerInfo, Method.RecentBeaconBlocks, request);
  }
}
