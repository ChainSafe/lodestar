/**
 * @module metrics
 */
import {collectDefaultMetrics, Registry} from "prom-client";

import {IMetrics} from "./interface";
import {IMetricsOptions} from "./options";


export class Metrics implements IMetrics {
  public registry: Registry;

  private defaultInterval: NodeJS.Timeout|null = null;
  private opts: IMetricsOptions;

  public constructor(opts: IMetricsOptions) {
    this.opts = opts;
    this.registry = new Registry();
  }

  public async start(): Promise<void> {
    this.defaultInterval = collectDefaultMetrics({
      register: this.registry,
      timeout: this.opts.timeout,
    }) as NodeJS.Timeout;
  }

  public async stop(): Promise<void> {
    clearInterval(this.defaultInterval as NodeJS.Timeout);
  }
}
