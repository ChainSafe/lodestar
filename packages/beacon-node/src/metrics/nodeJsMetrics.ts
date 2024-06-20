import {EventLoopUtilization, performance} from "node:perf_hooks";
import {collectDefaultMetrics, Histogram, Registry} from "prom-client";
import {gcStats} from "@chainsafe/prometheus-gc-stats";

/**
 * Collects event loop utilization metrics compared to the last call
 *
 * @param interval how often to collect the metrics in seconds
 */
function collectEventLoopUtilization(register: Registry, prefix?: string, interval: number = 5): () => void {
  const key = `${prefix}_` ?? "";

  const metricUtilization = new Histogram({
    name: `${key}nodejs_eventloop_utilization`,
    help: "Histogram of Event Loop utilization between two successive calls.",
    registers: [register],
    buckets: [0.001, 0.01, 0.1, 0.5, 1],
  });

  const metricIdle = new Histogram({
    name: `${key}nodejs_eventloop_idle_seconds`,
    help: "Histogram of Event Loop idle time in seconds between two successive calls.",
    registers: [register],
    buckets: [1, interval / 10, interval / 2, interval],
  });

  const metricActive = new Histogram({
    name: `${key}nodejs_eventloop_active_seconds`,
    help: "Histogram of Event Loop active time in seconds between two successive calls.",
    registers: [register],
    buckets: [1, interval / 10, interval / 2, interval],
  });

  const previousEventLoopUtilizations = new Map<string, EventLoopUtilization>();
  const intervalId = setInterval(() => {
    const previousElu = previousEventLoopUtilizations.get(key);
    const currentElu = performance.eventLoopUtilization();
    // `idle` and `active` are in milliseconds, capped by `interval` * 1000
    // `utilization` is a ratio between 0 and 1, similar to regular CPU utilization
    const {utilization, idle, active} = performance.eventLoopUtilization(currentElu, previousElu);
    metricUtilization.observe(utilization);
    metricIdle.observe(idle * 1000);
    metricActive.observe(active * 1000);
    previousEventLoopUtilizations.set(key, currentElu);
  }, interval * 1000);

  return () => {
    clearInterval(intervalId);
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

  const terminateEluCollection = collectEventLoopUtilization(register, prefix);

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
