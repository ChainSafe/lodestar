import {RegistryMetricCreator} from "../utils/registryMetricCreator";

export type IExecutionEngineMetrics = ReturnType<typeof createExecutionEngineMetrics>;

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/explicit-function-return-type
export function createExecutionEngineMetrics(register: RegistryMetricCreator) {
  return {
    executionEngine: {
      responseTime: register.histogram<"method">({
        name: "execution_engine_response_time_seconds",
        help: "Total response time (including retries) for execution engine requests in seconds",
        labelNames: ["method"],
        buckets: [0.1, 1, 10, 100],
      }),
      retryCount: register.gauge<"method">({
        name: "execution_engine_retry_count",
        help: "Count of retries to the execution engine",
        labelNames: ["method"],
      }),
      errorCount: register.gauge<"method">({
        name: "execution_engine_error_count",
        help: "Count of api requests that finally failed",
        labelNames: ["method"],
      }),
    },
  };
}
