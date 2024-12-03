import {ChainForkConfig} from "@lodestar/config";
import {BeaconStateAllForks, getCurrentSlot} from "@lodestar/state-transition";
import {Logger} from "@lodestar/utils";
import {Metric, Registry} from "prom-client";
import {BeaconMetrics, createBeaconMetrics} from "./metrics/beacon.js";
import {LodestarMetrics, createLodestarMetrics} from "./metrics/lodestar.js";
import {collectNodeJSMetrics} from "./nodeJsMetrics.js";
import {MetricsOptions} from "./options.js";
import {RegistryMetricCreator} from "./utils/registryMetricCreator.js";
import {ValidatorMonitor, createValidatorMonitor} from "./validatorMonitor.js";

export type Metrics = BeaconMetrics &
  LodestarMetrics &
  ValidatorMonitor & {register: RegistryMetricCreator; close: () => void};

export function createMetrics(
  opts: MetricsOptions,
  config: ChainForkConfig,
  anchorState: BeaconStateAllForks,
  logger: Logger,
  externalRegistries: Registry[] = []
): Metrics {
  const register = new RegistryMetricCreator();
  const beacon = createBeaconMetrics(register);
  const lodestar = createLodestarMetrics(register, opts.metadata, anchorState);

  const genesisTime = anchorState.genesisTime;
  const validatorMonitor = createValidatorMonitor(lodestar, config, genesisTime, logger, opts);
  // Register a single collect() function to run all validatorMonitor metrics
  lodestar.validatorMonitor.validatorsConnected.addCollect(() => {
    const clockSlot = getCurrentSlot(config, genesisTime);
    validatorMonitor.scrapeMetrics(clockSlot);
  });
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
    ...validatorMonitor,
    register,
    close,
  };
}
