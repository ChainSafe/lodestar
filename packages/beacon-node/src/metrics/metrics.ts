import {Metric, Registry} from "prom-client";
import {Logger} from "@lodestar/utils";
import {BeaconStateAllForks, getCurrentSlot} from "@lodestar/state-transition";
import {ChainForkConfig} from "@lodestar/config";
import {createBeaconMetrics, BeaconMetrics} from "./metrics/beacon.js";
import {createLodestarMetrics, LodestarMetrics} from "./metrics/lodestar.js";
import {MetricsOptions} from "./options.js";
import {RegistryMetricCreator} from "./utils/registryMetricCreator.js";
import {createValidatorMonitor, ValidatorMonitor} from "./validatorMonitor.js";
import {collectNodeJSMetrics} from "./nodeJsMetrics.js";

export type Metrics = BeaconMetrics & LodestarMetrics & ValidatorMonitor & {register: RegistryMetricCreator};

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
  const validatorMonitor = createValidatorMonitor(lodestar, config, genesisTime, logger);
  // Register a single collect() function to run all validatorMonitor metrics
  lodestar.validatorMonitor.validatorsConnected.addCollect(() => {
    const clockSlot = getCurrentSlot(config, genesisTime);
    validatorMonitor.scrapeMetrics(clockSlot);
  });
  process.on("unhandledRejection", (_error) => {
    lodestar.unhandledPromiseRejections.inc();
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
