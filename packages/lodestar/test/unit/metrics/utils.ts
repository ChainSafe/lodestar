import {config} from "@chainsafe/lodestar-config/default";
import {ssz} from "@chainsafe/lodestar-types";
import {createMetrics, IMetrics} from "../../../src/metrics";

export function createMetricsTest(): IMetrics {
  const state = ssz.phase0.BeaconState.defaultValue();
  return createMetrics({enabled: true, timeout: 12000}, config, state);
}
