/**
 * @module api/rpc/transport
 */


import http from "http";
import {promisify} from "es6-promisify";
import WebSocket from "ws";
import {ILogger} from  "@chainsafe/eth2.0-utils/lib/logger";
import {IRpcServer} from "./index";

export interface IWsServerOpts {
  host: string;
  port: number;
}

export class WSServer implements IRpcServer {

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public on: any;

  private ws: WebSocket.Server;
  private httpServer: http.Server;
  private opts: IWsServerOpts;
  private logger: ILogger;

  public constructor(opts: IWsServerOpts, {logger}: {logger: ILogger}) {
    this.opts = opts;
    this.logger = logger;
    this.httpServer = http.createServer();
    this.ws = new WebSocket.Server({server: this.httpServer});
    this.on = this.ws.on.bind(this.ws);
  }
  public async start(): Promise<void> {
    // @ts-ignore
    await promisify(this.httpServer.listen.bind(this.httpServer))(this.opts.port, this.opts.host);
    this.logger.info(`JSON RPC WS server started on ${this.opts.host}:${this.opts.port}`);
  }
  public async stop(): Promise<void> {
    await promisify(this.ws.close.bind(this.ws))();
    await promisify(this.httpServer.close.bind(this.httpServer))();
  }
}
