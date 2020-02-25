/**
 * @module metrics/server
 */
import http from "http";
import url from "url";
import {promisify} from "es6-promisify";
import {IMetrics, IMetricsServer} from "../interface";
import {IMetricsOptions} from "../options";
import {ILogger} from  "@chainsafe/lodestar-utils/lib/logger";

export class HttpMetricsServer implements IMetricsServer {
  private opts: IMetricsOptions;
  private metrics: IMetrics;
  private http: http.Server;
  private logger: ILogger;

  public constructor(opts: IMetricsOptions, {metrics, logger}: {metrics: IMetrics; logger: ILogger}) {
    this.opts = opts;
    this.logger = logger;
    this.metrics = metrics;
    this.http = http.createServer(this.onRequest.bind(this));
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
      await promisify(this.http.close.bind(this.http))();
    }
  }

  private onRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.method === "GET" && url.parse(req.url as string, true).pathname === "/metrics") {
      res.writeHead(200, {"content-type": this.metrics.registry.contentType});
      res.end(this.metrics.registry.metrics());
    } else {
      res.writeHead(404);
      res.end();
    }
  }

}
