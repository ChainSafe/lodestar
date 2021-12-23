import {AbortController} from "@chainsafe/abort-controller";
import {config} from "@chainsafe/lodestar-config/default";
import {createMetrics, IMetrics} from "../../../src/metrics";

export function createMetricsTest(): IMetrics {
  const controller = new AbortController();
  return createMetrics({enabled: true, timeout: 12000}, config, {genesisTime: 0}, controller.signal);
}
