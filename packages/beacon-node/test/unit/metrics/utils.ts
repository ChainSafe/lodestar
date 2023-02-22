import {config} from "@lodestar/config/default";
import {ssz} from "@lodestar/types";
import {createMetrics, Metrics} from "../../../src/metrics/index.js";
import {testLogger} from "../../utils/logger.js";

export function createMetricsTest(): Metrics {
  const state = ssz.phase0.BeaconState.defaultViewDU();
  const logger = testLogger();
  return createMetrics({enabled: true, port: 0}, config, state, logger);
}
