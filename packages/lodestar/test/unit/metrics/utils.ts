import {config} from "@chainsafe/lodestar-config/default";
import {ssz} from "@chainsafe/lodestar-types";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {createMetrics, IMetrics} from "../../../src/metrics/index.js";

export function createMetricsTest(): IMetrics {
  const state = ssz.phase0.BeaconState.defaultViewDU();
  const logger = new WinstonLogger();
  return createMetrics({enabled: true, port: 0}, config, state, logger);
}
