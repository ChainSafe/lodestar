import http from "node:http";
import {Registry} from "prom-client";
import {Logger} from "@lodestar/utils";
import {wrapError} from "../../util/wrapError.js";
import {HistogramExtra} from "../utils/histogram.js";
import {HttpActiveSocketsTracker} from "../../api/rest/activeSockets.js";
import {RegistryMetricCreator} from "../utils/registryMetricCreator.js";

export type HttpMetricsServerOpts = {
  port: number;
  address?: string;
};

export class HttpMetricsServer {
  private readonly server: http.Server;
  private readonly register: Registry;
  private readonly getOtherMetrics: () => Promise<string>;
  private readonly logger: Logger;
  private readonly activeSockets: HttpActiveSocketsTracker;

  private readonly httpServerRegister: RegistryMetricCreator;
  private readonly scrapeTimeMetric: HistogramExtra<"status">;

  constructor(
    private readonly opts: HttpMetricsServerOpts,
    {
      register,
      getOtherMetrics = async () => "",
      logger,
    }: {register: Registry; getOtherMetrics?: () => Promise<string>; logger: Logger}
  ) {
    this.logger = logger;
    this.register = register;
    this.getOtherMetrics = getOtherMetrics;
    this.server = http.createServer(this.onRequest.bind(this));

    // New registry to metric the metrics. Using the same registry would deadlock the .metrics promise
    this.httpServerRegister = new RegistryMetricCreator();

    this.scrapeTimeMetric = this.httpServerRegister.histogram<"status">({
      name: "lodestar_metrics_scrape_seconds",
      help: "Lodestar metrics server async time to scrape metrics",
      labelNames: ["status"],
      buckets: [0.1, 1, 10],
    });

    const socketsMetrics = {
      activeSockets: this.httpServerRegister.gauge({
        name: "lodestar_metrics_server_active_sockets_count",
        help: "Metrics server current count of active sockets",
      }),
      socketsBytesRead: this.httpServerRegister.gauge({
        name: "lodestar_metrics_server_sockets_bytes_read_total",
        help: "Metrics server total count of bytes read on all sockets",
      }),
      socketsBytesWritten: this.httpServerRegister.gauge({
        name: "lodestar_metrics_server_sockets_bytes_written_total",
        help: "Metrics server total count of bytes written on all sockets",
      }),
    };

    this.activeSockets = new HttpActiveSocketsTracker(this.server, socketsMetrics);
  }

  async start(): Promise<void> {
    const {port, address} = this.opts;
    this.logger.info("Starting metrics HTTP server", {port, address: address ?? "127.0.0.1"});
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, address, resolve);
    });
  }

  async stop(): Promise<void> {
    // In NodeJS land calling close() only causes new connections to be rejected.
    // Existing connections can prevent .close() from resolving for potentially forever.
    // In Lodestar case when the BeaconNode wants to close we will just abruptly terminate
    // all existing connections for a fast shutdown.
    // Inspired by https://github.com/gajus/http-terminator/
    this.activeSockets.destroyAll();

    await new Promise<void>((resolve, reject) => {
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async onRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method === "GET" && req.url && req.url.includes("/metrics")) {
      const timer = this.scrapeTimeMetric.startTimer();
      const metricsRes = await Promise.all([wrapError(this.register.metrics()), this.getOtherMetrics()]);
      timer({status: metricsRes[0].err ? "error" : "success"});

      // Ensure we only writeHead once
      if (metricsRes[0].err) {
        res.writeHead(500, {"content-type": "text/plain"}).end(metricsRes[0].err.stack);
      } else {
        // Get scrape time metrics
        const httpServerMetrics = await this.httpServerRegister.metrics();
        const metricsStr = `${metricsRes[0].result}\n\n${metricsRes[1]}\n\n${httpServerMetrics}`;
        res.writeHead(200, {"content-type": this.register.contentType}).end(metricsStr);
      }
    } else {
      res.writeHead(404).end();
    }
  }
}
