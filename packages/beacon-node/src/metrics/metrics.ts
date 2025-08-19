import {BeaconStateTransitionMetrics, getMetrics} from "@lodestar/state-transition";
import {Metric, Registry} from "prom-client";
import {UnknownChainSyncMetrics, createUnknownChainSyncMetrics} from "../sync/unknownChain/metrics.js";
import {BeaconMetrics, createBeaconMetrics} from "./metrics/beacon.js";
import {LodestarMetrics, createLodestarMetrics} from "./metrics/lodestar.js";
import {collectNodeJSMetrics} from "./nodeJsMetrics.js";
import {MetricsOptions} from "./options.js";
import {RegistryMetricCreator} from "./utils/registryMetricCreator.js";

export type Metrics = BeaconMetrics &
  BeaconStateTransitionMetrics &
  UnknownChainSyncMetrics &
  LodestarMetrics & {register: RegistryMetricCreator; close: () => void};

export function createMetrics(opts: MetricsOptions, genesisTime: number, externalRegistries: Registry[] = []): Metrics {
  const register = new RegistryMetricCreator();
  const beacon = createBeaconMetrics(register);
  const lodestar = createLodestarMetrics(register, opts.metadata, genesisTime);
  const unknownChainSync = createUnknownChainSyncMetrics(register);
  const stateTransition = getMetrics(register);

  process.on("unhandledRejection", (_error) => {
    lodestar.unhandledPromiseRejections.inc();
  });

  const close = collectNodeJSMetrics(register);

  // Merge external registries
  for (const externalRegister of externalRegistries) {
    for (const metric of externalRegister.getMetricsAsArray()) {
      register.registerMetric(metric as unknown as Metric<string>);
    }
  }

  return {
    ...beacon,
    ...lodestar,
    ...stateTransition,
    ...unknownChainSync,
    register,
    close,
  };
}
