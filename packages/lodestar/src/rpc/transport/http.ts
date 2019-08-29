/**
 * @module rpc/transport
 */

import {ILikeSocketServer} from "../protocol";
import {LikeSocket} from "noice-json-rpc";
import http from "http";
// @ts-ignore
import promisify from "promisify-es6";
import {ILogger} from "../../logger";
import {ITransportOption} from "../options";

class MessageRequest implements LikeSocket {

  private resp: http.ServerResponse;
  private req: http.IncomingMessage;

  // @ts-ignore
  private messageCallback: Function;

  public constructor(req: http.IncomingMessage, resp: http.ServerResponse) {
    this.req = req;
    this.resp = resp;
  }

  public on(event: string, cb: Function): void {
    if(event === "message") {
      const that = this;
      this.messageCallback = cb;
      this.getRequest(this.req)
        .then((message) => {
          if(that.messageCallback) {
            that.messageCallback(message);
          }
        });
    }
  }

  /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
  public removeListener(event: string, cb: Function): void {
  }

  public send(message: string): void {
    this.sendJsonResponse(message);
  }

  private sendJsonResponse(message: string): void {
    this.resp.writeHead(200, {"Content-Type": "application/json"});
    this.resp.write(message);
    this.resp.end();
  }

  private getRequest(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
      let body = "";
      req.on("data", chunk => {
        body += chunk.toString();
      });
      req.on("end", () => {
        resolve(body);
      });
    });
  }

}


export class HttpServer implements ILikeSocketServer{

  public server: http.Server;

  private opts: ITransportOption;

  // @ts-ignore
  private connectionCallback: Function;

  private logger: ILogger;

  public constructor(opts: ITransportOption, {logger}: {logger: ILogger}) {
    this.opts = opts;
    this.logger = logger;
    this.server = http.createServer(async (req, resp) => {
      if (req.method === "POST") {
        if(this.connectionCallback) {
          this.connectionCallback(new MessageRequest(req, resp));
        }
      } else {
        resp.writeHead(400);
        resp.write("Unsupported method");
        resp.end();
      }
    });
  }

  public on(event: string, cb: Function): void {
    if (event === "connection") {
      this.connectionCallback = cb;
    }
  }

  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.listen(this.opts.port)
        .on("listening", () => {
          this.logger.info(`JSON RPC HTTP server started on port ${this.opts.port}`);
          resolve();
        })
        .on("error", e => {
          this.logger.error(
            `Failed to start JSON RPC HTTP server on port ${this.opts.port}. Reason: ${e.message}`
          );
          reject(e);
        });
    });
  }

  public async stop(): Promise<void> {
    await promisify(this.server.close.bind(this.server))();
  }

}
