import {Metric, Registry} from "prom-client";
import {ForkChoiceMetrics, getForkChoiceMetrics} from "@lodestar/fork-choice";
import {BeaconStateTransitionMetrics, getMetrics} from "@lodestar/state-transition";
import {BeaconMetrics, createBeaconMetrics} from "./metrics/beacon.js";
import {LodestarMetrics, createLodestarMetrics} from "./metrics/lodestar.js";
import {collectNodeJSMetrics} from "./nodeJsMetrics.js";
import {MetricsOptions} from "./options.js";
import {RegistryMetricCreator} from "./utils/registryMetricCreator.js";

export type Metrics = BeaconMetrics &
  ForkChoiceMetrics &
  BeaconStateTransitionMetrics &
  LodestarMetrics & {register: RegistryMetricCreator; close: () => void};

export function createMetrics(opts: MetricsOptions, genesisTime: number, externalRegistries: Registry[] = []): Metrics {
  const register = new RegistryMetricCreator();
  const beacon = createBeaconMetrics(register);
  const forkChoice = getForkChoiceMetrics(register);
  const lodestar = createLodestarMetrics(register, opts.metadata, genesisTime);
  const stateTransition = getMetrics(register);

  const onUnhandledRejection = (_error: unknown): void => {
    lodestar.unhandledPromiseRejections.inc();
  };
  process.on("unhandledRejection", onUnhandledRejection);

  const nodeJsMetricsClose = collectNodeJSMetrics(register);
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
    ...forkChoice,
    ...lodestar,
    ...stateTransition,
    register,
    close,
  };
}
