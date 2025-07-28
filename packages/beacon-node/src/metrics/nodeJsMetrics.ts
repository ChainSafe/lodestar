import {Registry, collectDefaultMetrics} from "prom-client";
import {IS_BUN} from "../util/bun.js";

export async function collectNodeJSMetrics(register: Registry, prefix?: string): Promise<() => void> {
  collectDefaultMetrics({
    register,
    prefix,
    // eventLoopMonitoringPrecision with sampling rate in milliseconds
    eventLoopMonitoringPrecision: 10,
  });

  // Collects GC metrics using node:v8's GCProfiler
  // - nodejs_gc_runs_total: Counts the number of time GC is invoked
  // - nodejs_gc_pause_seconds_total: Time spent in GC in seconds
  // - nodejs_gc_reclaimed_bytes_total: The number of bytes GC has freed
  // `close` must be called to stop the gc collection process from continuing
  if (IS_BUN) {
    // Bun does not support the v8 GCProfiler, so we do not collect GC metrics
    // See https://github.com/ChainSafe/lodestar/issues/8089
    return () => {};
  }

  const {gcStats} = await import("@chainsafe/prometheus-gc-stats");
  const close = gcStats(register, {collectionInterval: 6000, prefix});
  return close;
}
