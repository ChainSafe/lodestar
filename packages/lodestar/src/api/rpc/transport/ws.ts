/**
 * @module api/rpc/transport
 */


import http from "http";
//@ts-ignore
import promisify from "promisify-es6";
import WebSocket from "ws";
import {ILogger} from "../../../logger";
import {IRpcServer} from "./index";

export interface IWsServerOpts {
  host: string;
  port: number;
}

export class WSServer implements IRpcServer {
  private ws: WebSocket.Server;
  private httpServer: http.Server;
  private opts: IWsServerOpts;
  private logger: ILogger;

  public on: any;
  public constructor(opts: IWsServerOpts, {logger}: {logger: ILogger}) {
    this.opts = opts;
    this.logger = logger;
    this.httpServer = http.createServer();
    this.ws = new WebSocket.Server({server: this.httpServer});
    this.on = this.ws.on.bind(this.ws);
  }
  public async start(): Promise<void> {
    await promisify(this.httpServer.listen.bind(this.httpServer))(this.opts.port, this.opts.host);
    this.logger.info(`JSON RPC WS server started on ${this.opts.host}:${this.opts.port}`);
  }
  public async stop(): Promise<void> {
    await promisify(this.ws.close.bind(this.ws))();
    await promisify(this.httpServer.close.bind(this.httpServer))();
  }
}
