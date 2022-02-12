/**
 * @module metrics/server
 */
import http from "node:http";
import {createHttpTerminator, HttpTerminator} from "http-terminator";
import {Registry} from "prom-client";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IMetricsOptions} from "../options";
import {wrapError} from "../../util/wrapError";
import {HistogramExtra} from "../utils/histogram";

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface IMetricsServer {}

type RegistryHolder = {
  register: Registry;
};

export class HttpMetricsServer implements IMetricsServer {
  http: http.Server;
  private terminator: HttpTerminator;
  private opts: IMetricsOptions;
  private register: Registry;
  private logger: ILogger;

  private httpServerRegister: Registry;
  private scrapeTimeMetric: HistogramExtra<"status">;

  constructor(opts: IMetricsOptions, {metrics, logger}: {metrics: RegistryHolder; logger: ILogger}) {
    this.opts = opts;
    this.logger = logger;
    this.register = metrics.register;
    this.http = http.createServer(this.onRequest.bind(this));
    this.terminator = createHttpTerminator({server: this.http});

    // New registry to metric the metrics. Using the same registry would deadlock the .metrics promise
    this.httpServerRegister = new Registry();
    this.scrapeTimeMetric = new HistogramExtra<"status">({
      name: "lodestar_metrics_scrape_seconds",
      help: "Time async to scrape metrics",
      labelNames: ["status"],
      buckets: [0.1, 1, 10],
    });

    this.httpServerRegister.registerMetric(this.scrapeTimeMetric);
  }

  async start(): Promise<void> {
    const {serverPort, listenAddr} = this.opts;
    this.logger.info("Starting metrics HTTP server", {port: serverPort ?? null});
    const listen = this.http.listen.bind(this.http);
    return new Promise((resolve, reject) => {
      listen(serverPort, listenAddr).once("listening", resolve).once("error", reject);
    });
  }

  async stop(): Promise<void> {
    try {
      await this.terminator.terminate();
    } catch (e) {
      this.logger.warn("Failed to stop metrics server", {}, e as Error);
    }
  }

  private async onRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method === "GET" && req.url && req.url.includes("/metrics")) {
      const timer = this.scrapeTimeMetric.startTimer();
      const metricsRes = await wrapError(this.register.metrics());
      timer({status: metricsRes.err ? "error" : "success"});

      // Ensure we only writeHead once
      if (metricsRes.err) {
        res.writeHead(500, {"content-type": "text/plain"}).end(metricsRes.err.stack);
      } else {
        // Get scrape time metrics
        const httpServerMetrics = await this.httpServerRegister.metrics();
        const metricsStr = `${metricsRes.result}\n\n${httpServerMetrics}`;
        res.writeHead(200, {"content-type": this.register.contentType}).end(metricsStr);
      }
    } else {
      res.writeHead(404).end();
    }
  }
}
