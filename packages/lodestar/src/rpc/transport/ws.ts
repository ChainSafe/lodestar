/**
 * @module rpc/transport
 */

import * as http from "http";
// @ts-ignore
import promisify from "promisify-es6";
import WebSocket from "ws";
import {ILikeSocketServer} from "../protocol";
import {ITransportOption} from "../options";

export interface IWSServerOpts {
  port: number;
}

export class WSServer implements ILikeSocketServer {
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  public on: any;
  private ws: WebSocket.Server;
  private httpServer: http.Server;
  private opts: IWSServerOpts;

  public constructor(opts: ITransportOption) {
    this.opts = opts;
    this.httpServer = http.createServer();
    this.ws = new WebSocket.Server({server: this.httpServer});
    this.on = this.ws.on.bind(this.ws);
  }
  public async start(): Promise<void> {
    await promisify(this.httpServer.listen.bind(this.httpServer))(this.opts.port);
  }
  public async stop(): Promise<void> {
    await promisify(this.ws.close.bind(this.ws))();
    await promisify(this.httpServer.close.bind(this.httpServer))();
  }
}
