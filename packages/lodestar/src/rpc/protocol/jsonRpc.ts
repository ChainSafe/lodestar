/**
 * @module rpc/protocol
 */

import * as jsonRpc from "noice-json-rpc";

import {IApi} from "../api/interface";
import {IPublicApiOptions} from "../options";

export interface LikeSocketServer extends jsonRpc.LikeSocketServer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * JSON-RPC over some transport
 */
export class JSONRPC {
  private transports: LikeSocketServer[] = [];

  public constructor(
    opts: Partial<IPublicApiOptions>,
    {transports, apis}: {transports: LikeSocketServer[]; apis: IApi[]}
  ) {
    transports.forEach((transport) => {
      // attach the json-rpc server to underlying transport
      const rpcServer = new jsonRpc.Server(transport);
      const jsonRpcApi = rpcServer.api();
      apis.forEach((api) => {
        // collect the api methods into an enumerable object for rpc exposure
        const methods = {};
        for (let name of Object.getOwnPropertyNames(Object.getPrototypeOf(api))) {
          if (name !== 'constructor' && typeof api[name] === 'function') {
            methods[name] = api[name].bind(api);
          }
        }
        jsonRpcApi[api.namespace].expose(methods);
      });
      this.transports.push(transport);
    });
  }

  public async start(): Promise<void> {
    await Promise.all(this.transports.map(transport => transport.start()));
  }

  public async stop(): Promise<void> {
    await Promise.all(this.transports.map(transport => transport.stop()));
  }
}
