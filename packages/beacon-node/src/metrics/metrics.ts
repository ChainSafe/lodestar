import {Counter, Gauge, Histogram, Metric, Registry} from "prom-client";
import {ForkChoiceMetrics, getForkChoiceMetrics} from "@lodestar/fork-choice";
import {BeaconStateTransitionMetrics, getMetrics} from "@lodestar/state-transition";
import {CounterConfig, GaugeConfig, HistogramConfig, LabelKeys, LabelsGeneric, NoLabels} from "@lodestar/utils";
import {BeaconMetrics, createBeaconMetrics} from "./metrics/beacon.js";
import {LodestarMetrics, createLodestarMetrics} from "./metrics/lodestar.js";
import {collectNodeJSMetrics} from "./nodeJsMetrics.js";
import {MetricsOptions} from "./options.js";
import {RegistryMetricCreator} from "./utils/registryMetricCreator.js";

export type Metrics = BeaconMetrics &
  ForkChoiceMetrics &
  BeaconStateTransitionMetrics &
  LodestarMetrics & {register: RegistryMetricCreator; close: () => void};

export type CreateMetricsOptions = {
  /*
   * Toggle inclusion of state transition metrics.
   *
   * False when native state transition is used, so we
   * can grab metrics from the native implementation instead.
   * */
  includeStateTransitionMetrics?: boolean;
};

export function createMetrics(
  opts: MetricsOptions,
  genesisTime: number,
  externalRegistries: Registry[] = [],
  createOpts: CreateMetricsOptions = {}
): Metrics {
  const register = new RegistryMetricCreator();
  const beacon = createBeaconMetrics(register);
  const forkChoice = getForkChoiceMetrics(register);
  const lodestar = createLodestarMetrics(register, opts.metadata, genesisTime);
  const stateTransitionRegister = createOpts.includeStateTransitionMetrics === false ? unregisteredMetrics : register;
  const stateTransition = getMetrics(
    stateTransitionRegister,
    register,
    createOpts.includeStateTransitionMetrics === false ? "lodestar_chain" : "lodestar"
  );

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

export const unregisteredMetrics = {
  gauge<Labels extends LabelsGeneric = NoLabels>(configuration: GaugeConfig<Labels>) {
    return new Gauge<LabelKeys<Labels>>({...configuration, registers: []});
  },
  histogram<Labels extends LabelsGeneric = NoLabels>(configuration: HistogramConfig<Labels>) {
    return new Histogram<LabelKeys<Labels>>({...configuration, registers: []});
  },
  counter<Labels extends LabelsGeneric = NoLabels>(configuration: CounterConfig<Labels>) {
    return new Counter<LabelKeys<Labels>>({...configuration, registers: []});
  },
};
