/**
 * @module metrics/server
 */
import http from "http";
import {createHttpTerminator, HttpTerminator} from "http-terminator";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IMetrics, IMetricsServer} from "../interface";
import {IMetricsOptions} from "../options";
import {wrapError} from "../../util/wrapError";

export class HttpMetricsServer implements IMetricsServer {
  http: http.Server;
  private terminator: HttpTerminator;
  private opts: IMetricsOptions;
  private metrics: IMetrics;
  private logger: ILogger;

  constructor(opts: IMetricsOptions, {metrics, logger}: {metrics: IMetrics; logger: ILogger}) {
    this.opts = opts;
    this.logger = logger;
    this.metrics = metrics;
    this.http = http.createServer(this.onRequest.bind(this));
    this.terminator = createHttpTerminator({server: this.http});
  }

  async start(): Promise<void> {
    if (this.opts.enabled) {
      const {serverPort, listenAddr} = this.opts;
      this.logger.info("Starting metrics HTTP server", {port: serverPort || null});
      const listen = this.http.listen.bind(this.http);
      return new Promise((resolve, reject) => {
        listen(serverPort, listenAddr).once("listening", resolve).once("error", reject);
      });
    }
  }
  async stop(): Promise<void> {
    if (this.opts.enabled) {
      try {
        await this.terminator.terminate();
      } catch (e) {
        this.logger.warn("Failed to stop metrics server", e);
      }
    }
  }

  private async onRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method === "GET" && req.url && req.url.includes("/metrics")) {
      const metricsRes = await wrapError(this.metrics.registry.metrics());
      if (metricsRes.err) {
        res.writeHead(500, {"content-type": "text/plain"}).end(metricsRes.err.stack);
      } else {
        res.writeHead(200, {"content-type": this.metrics.registry.contentType}).end(metricsRes.result);
      }
    } else {
      res.writeHead(404).end();
    }
  }
}
