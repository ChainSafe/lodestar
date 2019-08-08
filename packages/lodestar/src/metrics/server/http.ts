/**
 * @module metrics/server
 */
import http from "http";
import url from "url";
import promisify from "promisify-es6";

import {IMetrics, IMetricsServer} from "../interface";
import {IMetricsOptions} from "../options";

export class HttpMetricsServer implements IMetricsServer {
  private opts: IMetricsOptions;
  private metrics: IMetrics;
  private http: http.Server;
  public constructor(opts: IMetricsOptions, {metrics}: {metrics: IMetrics}) {
    this.opts = opts;
    this.metrics = metrics;
    this.http = http.createServer(this.onRequest.bind(this));
  }
  private onRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.method === "GET" && url.parse(req.url, true).pathname === "/metrics") {
      res.writeHead(200, {"content-type": this.metrics.registry.contentType});
      res.end(this.metrics.registry.metrics());
    } else {
      res.writeHead(404);
      res.end();
    }
  }
  public async start(): Promise<void> {
    await promisify(this.http.listen.bind(this.http))(this.opts.serverPort);
  }
  public async stop(): Promise<void> {
    await promisify(this.http.close.bind(this.http))();
  }
}
