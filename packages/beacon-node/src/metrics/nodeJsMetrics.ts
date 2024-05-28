import {EventLoopUtilization, performance} from "node:perf_hooks";
import {collectDefaultMetrics, Histogram, Registry} from "prom-client";
import {gcStats} from "@chainsafe/prometheus-gc-stats";

/**
 * Collects event loop utilization metrics compared to the last call
 */
function collectEvenLoopUtilization(register: Registry, prefix?: string, intervalMs: number = 5000): () => void {
  const key = `${prefix}_` ?? "";

  const metricUtilization = new Histogram({
    name: `${key}nodejs_eventloop_utilization`,
    help: "Histogram of Event Loop utilization between two successive calls.",
    registers: [register],
    buckets: [0.001, 0.01, 0.1, 0.5, 1],
  });

  const metricIdle = new Histogram({
    name: `${key}_nodejs_eventloop_idle`,
    help: "Histogram of Event Loop idle time between two successive calls.",
    registers: [register],
    buckets: [1, intervalMs / 10, intervalMs / 2, intervalMs],
  });

  const metricActive = new Histogram({
    name: `${key}_nodejs_eventloop_active`,
    help: "Histogram of Event Loop active time between two successive calls.",
    registers: [register],
    buckets: [1, intervalMs / 10, intervalMs / 2, intervalMs],
  });

  const previousEventLoopUtilizations = new Map<string, EventLoopUtilization>();
  const interval = setInterval(() => {
    const previousElu = previousEventLoopUtilizations.get(key);
    const currentElu = performance.eventLoopUtilization();
    const {utilization, idle, active} = performance.eventLoopUtilization(currentElu, previousElu);
    metricUtilization.observe(utilization); /* between 0-1 */
    metricIdle.observe(idle); /* in ms, max `intervalMs` */
    metricActive.observe(active); /* in ms, max `intervalMs` */
    previousEventLoopUtilizations.set(key, currentElu);
  }, intervalMs);

  return () => {
    clearInterval(interval);
    previousEventLoopUtilizations.clear();
  };
}

export function collectNodeJSMetrics(register: Registry, prefix?: string): () => void {
  collectDefaultMetrics({
    register,
    prefix,
    // eventLoopMonitoringPrecision with sampling rate in milliseconds
    eventLoopMonitoringPrecision: 10,
  });

  const terminateEluCollection = collectEvenLoopUtilization(register, prefix);

  // Collects GC metrics using a native binding module
  // - nodejs_gc_runs_total: Counts the number of time GC is invoked
  // - nodejs_gc_pause_seconds_total: Time spent in GC in seconds
  // - nodejs_gc_reclaimed_bytes_total: The number of bytes GC has freed
  // `close` must be called to stop the gc collection process from continuing
  const terminateGCCollection = gcStats(register, {collectionInterval: 6000, prefix});

  return () => {
    terminateGCCollection();
    terminateEluCollection();
  };
}
