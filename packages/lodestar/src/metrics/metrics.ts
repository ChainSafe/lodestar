import {getCurrentSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {collectDefaultMetrics, Counter, Registry} from "prom-client";
import gcStats from "prometheus-gc-stats";
import {AbortSignal} from "@chainsafe/abort-controller";
import {DbMetricLabels, IDbMetrics} from "@chainsafe/lodestar-db";
import {createBeaconMetrics, IBeaconMetrics} from "./metrics/beacon";
import {createLodestarMetrics, ILodestarMetrics} from "./metrics/lodestar";
import {defaultMetricsOptions, IMetricsOptions} from "./options";
import {RegistryMetricCreator} from "./utils/registryMetricCreator";
import {createValidatorMonitor, IValidatorMonitor} from "./validatorMonitor";
import {trackAsyncLag} from "./asyncLag";

export type IMetrics = IBeaconMetrics & ILodestarMetrics & IValidatorMonitor & {register: Registry};

export function createMetrics(
  opts: IMetricsOptions,
  config: IChainForkConfig,
  genesisData: {genesisTime: number},
  signal: AbortSignal,
  registries: Registry[] = []
): IMetrics {
  const register = new RegistryMetricCreator();
  const beacon = createBeaconMetrics(register);
  const lodestar = createLodestarMetrics(register, opts.metadata, genesisData);

  // Track async lag, set asyncLagIntervalMs ==0 0 to disable trackAsyncLag()
  const asyncLagIntervalMs = opts.asyncLagIntervalMs ?? defaultMetricsOptions.asyncLagIntervalMs;
  if (asyncLagIntervalMs > 0) {
    trackAsyncLag(lodestar, opts.asyncLagIntervalMs ?? defaultMetricsOptions.asyncLagIntervalMs, signal).catch(() => {
      // Ignore errors
    });
  }

  const genesisTime = genesisData.genesisTime;
  const validatorMonitor = createValidatorMonitor(lodestar, config, genesisTime);
  // Register a single collect() function to run all validatorMonitor metrics
  lodestar.validatorMonitor.validatorsTotal.addCollect(() => {
    const clockSlot = getCurrentSlot(config, genesisTime);
    validatorMonitor.scrapeMetrics(clockSlot);
  });

  if (!opts.disabledUnhandledRejectionMetric) {
    process.on("unhandledRejection", (_error) => {
      lodestar.unhandeledPromiseRejections.inc();
    });
  }

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

  return {...beacon, ...lodestar, ...validatorMonitor, register: Registry.merge([register, ...registries])};
}

export function createDbMetrics(): {metrics: IDbMetrics; registry: Registry} {
  const metrics = {
    dbReads: new Counter<DbMetricLabels>({
      name: "lodestar_db_reads",
      labelNames: ["bucket"],
      help: "Number of db reads, contains bucket label.",
    }),
    dbWrites: new Counter<DbMetricLabels>({
      name: "lodestar_db_writes",
      labelNames: ["bucket"],
      help: "Number of db writes and deletes, contains bucket label.",
    }),
  };
  const registry = new Registry();
  registry.registerMetric(metrics.dbReads);
  registry.registerMetric(metrics.dbWrites);
  return {metrics, registry};
}
