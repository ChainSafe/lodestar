/**
 * @module metrics
 */
import {BeaconState} from "@chainsafe/lodestar-types/lib/allForks";
import {collectDefaultMetrics, Registry} from "prom-client";
import gcStats from "prometheus-gc-stats";
import {createBeaconMetrics, IBeaconMetrics} from "./metrics/beacon";
import {createLodestarMetrics, ILodestarMetrics} from "./metrics/lodestar";
import {IMetricsOptions} from "./options";
import {RegistryMetricCreator} from "./utils/registryMetricCreator";

export type IMetrics = IBeaconMetrics & ILodestarMetrics & {register: Registry};

export function createMetrics(opts?: IMetricsOptions, anchorState?: BeaconState): IMetrics {
  const register = new RegistryMetricCreator();
  const beacon = createBeaconMetrics(register);
  const lodestar = createLodestarMetrics(register, opts?.metadata, anchorState);

  collectDefaultMetrics({
    register,
    // eventLoopMonitoringPrecision with sampling rate in milliseconds
    eventLoopMonitoringPrecision: 10,
  });

  // Collects GC metrics using a native binding module
  // - nodejs_gc_runs_total: Counts the number of time GC is invoked
  // - nodejs_gc_pause_seconds_total: Time spent in GC in seconds
  // - nodejs_gc_reclaimed_bytes_total: The number of bytes GC has freed
  gcStats(register)();

  return {...beacon, ...lodestar, register};
}
