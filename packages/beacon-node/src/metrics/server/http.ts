import http from "node:http";
import {AddressInfo} from "node:net";
import {Registry} from "prom-client";
import {Logger} from "@lodestar/utils";
import {wrapError} from "../../util/wrapError.js";
import {HttpActiveSocketsTracker} from "../../api/rest/activeSockets.js";
import {RegistryMetricCreator} from "../utils/registryMetricCreator.js";

export type HttpMetricsServerOpts = {
  port: number;
  address?: string;
};

export type HttpMetricsServer = {
  close(): Promise<void>;
};

enum RequestStatus {
  success = "success",
  error = "error",
}

export async function getHttpMetricsServer(
  opts: HttpMetricsServerOpts,
  {
    register,
    getOtherMetrics = async () => "",
    logger,
  }: {register: Registry; getOtherMetrics?: () => Promise<string>; logger: Logger}
): Promise<HttpMetricsServer> {
  // New registry to metric the metrics. Using the same registry would deadlock the .metrics promise
  const httpServerRegister = new RegistryMetricCreator();

  const scrapeTimeMetric = httpServerRegister.histogram<{status: RequestStatus}>({
    name: "lodestar_metrics_scrape_seconds",
    help: "Lodestar metrics server async time to scrape metrics",
    labelNames: ["status"],
    buckets: [0.1, 1, 10],
  });

  const server = http.createServer(async function onRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    if (req.method === "GET" && req.url && req.url.includes("/metrics")) {
      const timer = scrapeTimeMetric.startTimer();
      const metricsRes = await Promise.all([wrapError(register.metrics()), getOtherMetrics()]);
      timer({status: metricsRes[0].err ? RequestStatus.error : RequestStatus.success});

      // Ensure we only writeHead once
      if (metricsRes[0].err) {
        res.writeHead(500, {"content-type": "text/plain"}).end(metricsRes[0].err.stack);
      } else {
        // Get scrape time metrics
        const httpServerMetrics = await httpServerRegister.metrics();
        const metricsStr = `${metricsRes[0].result}\n\n${metricsRes[1]}\n\n${httpServerMetrics}`;
        res.writeHead(200, {"content-type": register.contentType}).end(metricsStr);
      }
    } else {
      res.writeHead(404).end();
    }
  });

  const socketsMetrics = {
    activeSockets: httpServerRegister.gauge({
      name: "lodestar_metrics_server_active_sockets_count",
      help: "Metrics server current count of active sockets",
    }),
    socketsBytesRead: httpServerRegister.gauge({
      name: "lodestar_metrics_server_sockets_bytes_read_total",
      help: "Metrics server total count of bytes read on all sockets",
    }),
    socketsBytesWritten: httpServerRegister.gauge({
      name: "lodestar_metrics_server_sockets_bytes_written_total",
      help: "Metrics server total count of bytes written on all sockets",
    }),
  };

  const activeSockets = new HttpActiveSocketsTracker(server, socketsMetrics);

  await new Promise<void>((resolve, reject) => {
    server.once("error", (err) => {
      logger.error("Error starting metrics HTTP server", opts, err);
      reject(err);
    });
    server.listen(opts.port, opts.address, () => {
      const {port, address: host, family} = server.address() as AddressInfo;
      const address = `http://${family === "IPv6" ? `[${host}]` : host}:${port}`;
      logger.info("Started metrics HTTP server", {address});
      resolve();
    });
  });

  return {
    async close(): Promise<void> {
      // In NodeJS land calling close() only causes new connections to be rejected.
      // Existing connections can prevent .close() from resolving for potentially forever.
      // In Lodestar case when the BeaconNode wants to close we will attempt to gracefully
      // close all existing connections but forcefully terminate after timeout for a fast shutdown.
      // Inspired by https://github.com/gajus/http-terminator/
      await activeSockets.terminate();

      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      logger.debug("Metrics HTTP server closed");
    },
  };
}
