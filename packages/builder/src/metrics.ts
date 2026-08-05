import {MetricsRegisterExtra} from "@lodestar/utils";

export type Metrics = ReturnType<typeof getMetrics>;

export function getMetrics(_register: MetricsRegisterExtra) {
  return {};
}
