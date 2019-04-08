import * as http from "http";
import promisify from "promisify-es6";
import WebSocket from "ws";
import {LikeSocketServer} from "../protocol";

export interface WSServerOpts {
  port: number;
}

export class WSServer implements LikeSocketServer {
  private ws: WebSocket.Server;
  private httpServer: http.Server;
  private opts: WSServerOpts;
  public on: any;
  public constructor(opts) {
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
