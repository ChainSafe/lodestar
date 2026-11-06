import {MetricsRegisterExtra} from "@lodestar/utils";

export type Metrics = ReturnType<typeof getMetrics>;

export type LodestarGitData = {
  /** "0.16.0 developer/feature-1 4f816b16" */
  version: string;
  /** "4f816b16dfde718e2d74f95f2c8292596138c248" */
  commit: string;
  /** "hoodi" */
  network: string;
};

export enum SignResult {
  signed = "signed",
  unknownKey = "unknown_key",
  invalidRequest = "invalid_request",
  slashable = "slashable",
  error = "error",
}

export function getMetrics(register: MetricsRegisterExtra, gitData: LodestarGitData) {
  register
    .gauge<LodestarGitData>({
      name: "lodestar_version",
      help: "Lodestar version",
      labelNames: Object.keys(gitData) as [keyof LodestarGitData],
    })
    .set(gitData, 1);

  return {
    keys: register.gauge({
      name: "signer_keys_count",
      help: "Count of secret keys loaded into the signer",
    }),

    signRequests: register.counter<{type: string; result: SignResult}>({
      name: "signer_sign_requests_total",
      help: "Total count of signing requests by message type and result",
      labelNames: ["type", "result"],
    }),

    signTime: register.histogram<{type: string}>({
      name: "signer_sign_time_seconds",
      help: "Time to serve a signing request by message type, including slashing protection",
      labelNames: ["type"],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 1],
    }),

    // REST API server

    restApi: {
      responseTime: register.histogram<{operationId: string}>({
        name: "signer_rest_api_response_time_seconds",
        help: "REST API time to fulfill a request by operationId",
        labelNames: ["operationId"],
        buckets: [0.01, 0.1, 1],
      }),
      requests: register.gauge<{operationId: string}>({
        name: "signer_rest_api_requests_total",
        help: "REST API total count requests by operationId",
        labelNames: ["operationId"],
      }),
      errors: register.gauge<{operationId: string}>({
        name: "signer_rest_api_errors_total",
        help: "REST API total count of errors by operationId",
        labelNames: ["operationId"],
      }),
      // Metrics for HttpActiveSocketsTracker, defined there
      activeSockets: register.gauge({
        name: "signer_rest_api_active_sockets_count",
        help: "REST API current count of active sockets",
      }),
      socketsBytesRead: register.gauge({
        name: "signer_rest_api_sockets_bytes_read_total",
        help: "REST API total count of bytes read on all sockets",
      }),
      socketsBytesWritten: register.gauge({
        name: "signer_rest_api_sockets_bytes_written_total",
        help: "REST API total count of bytes written on all sockets",
      }),
    },
  };
}
