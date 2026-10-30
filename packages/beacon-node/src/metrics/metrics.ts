import {Metric, Registry} from "prom-client";
import {BeaconMetrics, createBeaconMetrics} from "./metrics/beacon.js";
import {LodestarMetrics, createLodestarMetrics} from "./metrics/lodestar.js";
import {collectNodeJSMetrics} from "./nodeJsMetrics.js";
import {MetricsOptions} from "./options.js";
import {RegistryMetricCreator} from "./utils/registryMetricCreator.js";

/**
 * [beacon-engine] Main-thread metrics, retaining the upstream name for BeaconChain and its callers.
 * BeaconEngine owns BeaconEngineMetrics. Shared families have independent recorders on each side
 * and are aggregated only when serving /metrics; never pass this registry into the engine.
 */
export type Metrics = BeaconMetrics &
  LodestarMetrics & {
    register: RegistryMetricCreator;
    close: () => void;
  };

export type CreateMetricsOptions = {
  collectNodeMetrics?: boolean;
};

export function createMetrics(
  opts: MetricsOptions,
  genesisTime: number,
  externalRegistries: Registry[] = [],
  createOpts: CreateMetricsOptions = {}
): Metrics {
  const register = new RegistryMetricCreator();
  const beacon = createBeaconMetrics(register);
  const lodestar = createLodestarMetrics(register, opts.metadata, genesisTime);

  const onUnhandledRejection = (_error: unknown): void => {
    lodestar.unhandledPromiseRejections.inc();
  };
  process.on("unhandledRejection", onUnhandledRejection);

  const nodeJsMetricsClose = createOpts.collectNodeMetrics === false ? (): void => {} : collectNodeJSMetrics(register);
  const close = (): void => {
    process.removeListener("unhandledRejection", onUnhandledRejection);
    nodeJsMetricsClose();
  };

  // Merge external registries
  for (const externalRegister of externalRegistries) {
    for (const metric of externalRegister.getMetricsAsArray()) {
      register.registerMetric(metric as unknown as Metric<string>);
    }
  }

  return {
    ...beacon,
    ...lodestar,
    register,
    close,
  };
}
