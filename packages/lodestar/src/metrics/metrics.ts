/**
 * @module metrics
 */
import {collectDefaultMetrics, Registry} from "prom-client";
import gcStats from "prometheus-gc-stats";

import {IMetrics} from "./interface";
import {IMetricsOptions} from "./options";

export class Metrics implements IMetrics {
  registry: Registry;

  constructor(opts: IMetricsOptions) {
    this.registry = new Registry();

    if (opts.enabled) {
      collectDefaultMetrics({
        register: this.registry,
        // eventLoopMonitoringPrecision with sampling rate in milliseconds
        eventLoopMonitoringPrecision: 10,
      });

      // Collects GC metrics using a native binding module
      // - nodejs_gc_runs_total: Counts the number of time GC is invoked
      // - nodejs_gc_pause_seconds_total: Time spent in GC in seconds
      // - nodejs_gc_reclaimed_bytes_total: The number of bytes GC has freed
      gcStats(this.registry)();
    }
  }
}
