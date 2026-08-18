import {BuilderStatus} from "@lodestar/types";
import {MetricsRegisterExtra} from "@lodestar/utils";

export type Metrics = ReturnType<typeof getMetrics>;

export type LodestarGitData = {
  /** "0.16.0 developer/feature-1 ac99f2b5" */
  version: string;
  /** "4f816b16dfde718e2d74f95f2c8292596138c248" */
  commit: string;
  /** "hoodi" */
  network: string;
};

export const builderStatusValue: Record<BuilderStatus, number> = {pending: 0, active: 1, exited: 2};

export function getMetrics(register: MetricsRegisterExtra, gitData: LodestarGitData) {
  register
    .gauge<LodestarGitData>({
      name: "lodestar_version",
      help: "Lodestar version",
      labelNames: Object.keys(gitData) as [keyof LodestarGitData],
    })
    .set(gitData, 1);

  return {
    builderStatus: register.gauge({
      name: "bc_status",
      help: "Current builder status: pending=0, active=1, exited=2",
    }),

    builderBalance: register.gauge({
      name: "bc_balance_gwei",
      help: "Current builder balance in gwei",
    }),

    // REST API client

    restApiClient: {
      requestTime: register.histogram<{routeId: string}>({
        name: "bc_rest_api_client_request_time_seconds",
        help: "Histogram of REST API client request time by routeId",
        labelNames: ["routeId"],
        // Expected times are ~ 50-500ms, but in an overload NodeJS they can be greater
        buckets: [0.01, 0.1, 1, 2, 5],
      }),

      streamTime: register.histogram<{routeId: string}>({
        name: "bc_rest_api_client_stream_time_seconds",
        help: "Histogram of REST API client streaming time by routeId",
        labelNames: ["routeId"],
        // Expected times are ~ 50-500ms, but in an overload NodeJS they can be greater
        buckets: [0.01, 0.1, 1, 2, 5],
      }),

      requestErrors: register.gauge<{routeId: string; baseUrl: string}>({
        name: "bc_rest_api_client_request_errors_total",
        help: "Total count of errors on REST API client requests by routeId",
        labelNames: ["routeId", "baseUrl"],
      }),

      requestToFallbacks: register.gauge<{routeId: string; baseUrl: string}>({
        name: "bc_rest_api_client_request_to_fallbacks_total",
        help: "Total count of requests to fallback URLs on REST API by routeId",
        labelNames: ["routeId", "baseUrl"],
      }),

      urlsScore: register.gauge<{urlIndex: number; baseUrl: string}>({
        name: "bc_rest_api_client_urls_score",
        help: "Current score of REST API URLs by url index",
        labelNames: ["urlIndex", "baseUrl"],
      }),
    },
  };
}
