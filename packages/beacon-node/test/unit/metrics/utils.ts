import {config} from "@lodestar/config/default";
import {ssz} from "@lodestar/types";
import {createMetrics, Metrics} from "../../../src/metrics/index.js";
import {testLogger} from "../../utils/logger.js";

export function createMetricsTest(): Metrics {
  const state = ssz.phase0.BeaconState.defaultViewDU();
  const logger = testLogger();
  const metrics = createMetrics({enabled: true, port: 0}, config, state, logger);
  // we don't need gc metrics running for tests
  metrics.close();
  return metrics;
}
