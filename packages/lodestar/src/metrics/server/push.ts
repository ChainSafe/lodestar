/**
 * @module metrics/server
 */
import {Pushgateway} from "prom-client";

import {IMetrics, IMetricsServer} from "../interface";
import {IMetricsOptions} from "../options";

export class PushMetricsServer implements IMetricsServer {
  private metrics: IMetrics;
  private opts: IMetricsOptions;
  private gateway: Pushgateway | null = null;
  constructor(opts: IMetricsOptions, {metrics}: {metrics: IMetrics}) {
    this.opts = opts;
    this.metrics = metrics;
  }
  start(): void {
    this.gateway = new Pushgateway(this.opts.gatewayUrl as string, {}, this.metrics.registry);
  }
  stop(): void {
    this.gateway = null;
  }
}
