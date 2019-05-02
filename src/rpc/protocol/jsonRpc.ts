import * as jsonRpc from "noice-json-rpc";


import {IValidatorApi, IBeaconApi} from "../api";

export interface LikeSocketServer extends jsonRpc.LikeSocketServer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * JSON-RPC over some transport
 *
 *
 */
export class JSONRPC {
  private rpcServer: jsonRpc.Server;
  private transport: LikeSocketServer;
  private jsonRpcApi;

  public constructor(opts, {transport, api}: {transport: LikeSocketServer; api: IBeaconApi | IValidatorApi}) {
    this.transport = transport;
    // attach the json-rpc server to underlying transport
    this.rpcServer = new jsonRpc.Server(this.transport);
    this.jsonRpcApi = this.rpcServer.api();
    // collect the api methods into an enumerable object for rpc exposure
    const methods = {};
    for (let name of Object.getOwnPropertyNames(Object.getPrototypeOf(api))) {
      if (name !== 'constructor' && typeof api[name] === 'function') {
        methods[name] = api[name].bind(api);
      }
    }
    this.jsonRpcApi.BeaconChain.expose(methods);
  }

  public async start(): Promise<void> {
    await this.transport.start();
  }

  public async stop(): Promise<void> {
    await this.transport.stop();
  }
}
