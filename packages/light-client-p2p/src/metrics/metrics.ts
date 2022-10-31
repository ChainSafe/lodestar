import {collectDefaultMetrics, Metric, Registry} from "prom-client";
import gcStats from "prometheus-gc-stats";
import {ILogger} from "@lodestar/utils";
import {BeaconStateAllForks, getCurrentSlot} from "@lodestar/state-transition";
import {IChainForkConfig} from "@lodestar/config";
import {createBeaconMetrics, IBeaconMetrics} from "./metrics/beacon.js";
import {createLodestarMetrics, ILodestarMetrics} from "./metrics/lodestar.js";
import {MetricsOptions} from "./options.js";
import {RegistryMetricCreator} from "./utils/registryMetricCreator.js";
import {createValidatorMonitor, IValidatorMonitor} from "./validatorMonitor.js";

export type IMetrics = IBeaconMetrics & ILodestarMetrics & IValidatorMonitor & {register: RegistryMetricCreator};

export function createMetrics(
  opts: MetricsOptions,
  config: IChainForkConfig,
  anchorState: BeaconStateAllForks,
  logger: ILogger,
  externalRegistries: Registry[] = []
): IMetrics {
  const register = new RegistryMetricCreator();
  const beacon = createBeaconMetrics(register);
  const lodestar = createLodestarMetrics(register, opts.metadata, anchorState);

  const genesisTime = anchorState.genesisTime;
  const validatorMonitor = createValidatorMonitor(lodestar, config, genesisTime, logger);
  // Register a single collect() function to run all validatorMonitor metrics
  lodestar.validatorMonitor.validatorsConnected.addCollect(() => {
    const clockSlot = getCurrentSlot(config, genesisTime);
    validatorMonitor.scrapeMetrics(clockSlot);
  });
  process.on("unhandledRejection", (_error) => {
    lodestar.unhandeledPromiseRejections.inc();
  });

  collectNodeJSMetrics(register);

  // Merge external registries
  for (const externalRegister of externalRegistries) {
    for (const metric of externalRegister.getMetricsAsArray()) {
      register.registerMetric((metric as unknown) as Metric<string>);
    }
  }

  return {
    ...beacon,
    ...lodestar,
    ...validatorMonitor,
    register,
  };
}

export function collectNodeJSMetrics(register: Registry): void {
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
}
