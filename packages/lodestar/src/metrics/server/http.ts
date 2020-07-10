/**
 * @module metrics/server
 */
import http from "http";
import {promisify} from "es6-promisify";
import {createHttpTerminator, HttpTerminator} from "http-terminator";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {IMetrics, IMetricsServer} from "../interface";
import {IMetricsOptions} from "../options";


export class HttpMetricsServer implements IMetricsServer {
  public http: http.Server;
  private terminator: HttpTerminator;
  private opts: IMetricsOptions;
  private metrics: IMetrics;
  private logger: ILogger;

  public constructor(opts: IMetricsOptions, {metrics, logger}: {metrics: IMetrics; logger: ILogger}) {
    this.opts = opts;
    this.logger = logger;
    this.metrics = metrics;
    this.http = http.createServer(this.onRequest.bind(this));
    this.terminator = createHttpTerminator({server: this.http});
  }

  public async start(): Promise<void> {
    if (this.opts.enabled) {
      this.logger.info(`Starting metrics HTTP server on port ${this.opts.serverPort}`);
      // @ts-ignore
      await promisify<void, number>(this.http.listen.bind(this.http))(this.opts.serverPort);
    }
  }
  public async stop(): Promise<void> {
    if (this.opts.enabled) {
      try {
        await this.terminator.terminate();
      } catch (e) {
        this.logger.warn("Failed to stop metrics server. Error: " + e.message);
      }
    }
  }

  private onRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.method === "GET" && req.url.includes("/metrics")) {
      res.writeHead(200, {"content-type": this.metrics.registry.contentType});
      res.end(this.metrics.registry.metrics());
    } else {
      res.writeHead(404);
      res.end();
    }
  }

}
