import {config} from "@chainsafe/lodestar-config/default";
import {ssz} from "@chainsafe/lodestar-types/lib/phase0";
import {createMetrics, IMetrics} from "../../../src/metrics";

export function createMetricsTest(): IMetrics {
  const state = ssz.BeaconState.defaultValue();
  return createMetrics({enabled: true, timeout: 12000}, config, state);
}
