/**
 * @module metrics
 */
import {collectDefaultMetrics, Registry} from "prom-client";
import gcStats from "prometheus-gc-stats";

import {IMetrics} from "./interface";
import {IMetricsOptions} from "./options";

export class Metrics implements IMetrics {
  public registry: Registry;

  private defaultInterval: NodeJS.Timeout | null = null;
  private opts: IMetricsOptions;

  public constructor(opts: IMetricsOptions) {
    this.opts = opts;
    this.registry = new Registry();

    this.defaultInterval = collectDefaultMetrics({
      register: this.registry,
      timeout: this.opts.timeout,
    }) as NodeJS.Timeout;

    // Collects GC metrics using a native binding module
    // - nodejs_gc_runs_total: Counts the number of time GC is invoked
    // - nodejs_gc_pause_seconds_total: Time spent in GC in seconds
    // - nodejs_gc_reclaimed_bytes_total: The number of bytes GC has freed
    gcStats(this.registry)();
  }

  public close(): void {
    clearInterval(this.defaultInterval as NodeJS.Timeout);
  }
}
