import {ssz} from "@lodestar/types";
import {Metrics, createMetrics} from "../../../src/metrics/index.js";

export function createMetricsTest(): Metrics {
  const state = ssz.phase0.BeaconState.defaultViewDU();
  const metrics = createMetrics({enabled: true, port: 0}, state.genesisTime);
  // we don't need gc metrics running for tests
  metrics.close();
  return metrics;
}
