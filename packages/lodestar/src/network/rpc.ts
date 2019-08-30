import {EventEmitter} from "events";
import LibP2p from "libp2p";
import LibP2pConnection from "interface-connection";
import promisify from "promisify-es6";
import pull from "pull-stream";
import varint from "varint";
import StrictEventEmitter from "strict-event-emitter-types";
import {RequestBody, ResponseBody} from "@chainsafe/eth2.0-types";
import {serialize, deserialize} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {
  Encoding, Method, RequestId,
  ERR_INVALID_REQ, ERR_RESP_TIMEOUT,
  REQ_RESP_MAX_SIZE, TTFB_TIMEOUT, RESP_TIMEOUT,
} from "../constants";
import {
  createRpcProtocol,
  createResponseEvent,
  randomRequestId,
} from "./util";
import { ILogger } from "../logger";

interface INetworkRpcEvents {
  request: (peerInfo: PeerInfo, method: Method, id: RequestId, body: RequestBody) => void;
  // we cannot typehint dynamic keys
  // [createResponseEvent(id: RequestId)]: (err: Error, data: ResponseBody) => void
}

type NetworkRpcEventEmitter = StrictEventEmitter<EventEmitter, INetworkRpcEvents>;
interface NetworkRpcEventEmitterClass {
  new(): NetworkRpcEventEmitter;
}

interface NetworkRpcModules {
  config: IBeaconConfig;
  libp2p: any;
  logger: ILogger;
}

export class NetworkRpc extends (EventEmitter as NetworkRpcEventEmitterClass) implements NetworkRpcEventEmitter {
  private config: IBeaconConfig;
  private libp2p: LibP2p;
  private logger: ILogger;
  private encoding: Encoding;

  public constructor(opts, {config, libp2p, logger}: NetworkRpcModules) {
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
          let peerInfo;
          while (!peerInfo) {
            peerInfo = await promisify(conn.getPeerInfo.bind(conn))();
          }
          pull(
            conn,
            this.handleRequest(peerInfo, method),
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
  private handleRequest = (peerInfo: PeerInfo, method: Method) => {
    return (read) => {
      return (end, cb) => {
        read(end, (end, data) => {
          if (end) return cb(end);
          try {
            const request = this.decodeRequest(method, data);
            const requestId = randomRequestId();
            this.emit("request", peerInfo, method, requestId, request);
            const responseListener = (err, output): void => {
              if (err) return cb(null, this.encodeResponseError(err));
              cb(null, this.encodeResponse(method, output));
            };
            const responseEvent = createResponseEvent(requestId);
            // @ts-ignore
            this.once(responseEvent, responseListener);
            setTimeout(() => {
              // @ts-ignore
              this.removeListener(responseEvent, responseListener);
              cb(null, this.encodeResponseError(new Error(ERR_RESP_TIMEOUT)));
            }, RESP_TIMEOUT);
          } catch (e) {
            cb(null, this.encodeResponseError(e));
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
    const b = Buffer.from("\255" + err.message);
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
      return {
        code,
        reason: data.toString("utf8"),
      };
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
  public sendResponse(id: RequestId, err: Error, body: ResponseBody): void {
    // @ts-ignore
    this.emit(`response ${id}`, err, body);
  }
  public async sendRequest(peerInfo: PeerInfo, method: Method, body: RequestBody): Promise<ResponseBody> {
    const protocol = createRpcProtocol(method, this.encoding);
    return await new Promise((resolve, reject) => {
      this.libp2p.dialProtocol(peerInfo, protocol, (conn) => {
        pull(
          pull.values([this.encodeRequest(method, body)]),
          conn,
          pull.drain((data) => resolve(this.decodeResponse(method, data))),
        );
      });
      setTimeout(() => reject(new Error(ERR_RESP_TIMEOUT)), RESP_TIMEOUT);
    });
  }
}
