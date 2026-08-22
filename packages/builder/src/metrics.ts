import {BuilderStatus} from "@lodestar/types";
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
      name: "bc_builder_status",
      help: "Current builder status: pending=0, active=1, exited=2",
    }),

    builderBalance: register.gauge({
      name: "bc_builder_balance_gwei",
      help: "Current builder balance in gwei",
    }),

    builds: {
      prepareTime: register.histogram<{source: string}>({
        name: "bc_builder_payload_prepare_time_seconds",
        help: "Time from payload attributes until the execution client accepted the build request",
        labelNames: ["source"],
        buckets: [0.05, 0.1, 0.5, 1, 2, 4, 8],
      }),
      prepareFailed: register.counter<{source: string}>({
        name: "bc_builder_payload_prepare_failed_total",
        help: "Count of payload builds that could not be started before the bid deadline",
        labelNames: ["source"],
      }),
      getPayloadTime: register.histogram<{source: string}>({
        name: "bc_builder_get_payload_time_seconds",
        help: "Time to fetch a built payload from the execution client",
        labelNames: ["source"],
        buckets: [0.01, 0.05, 0.1, 0.5, 1, 2],
      }),
    },

    bids: {
      submitted: register.counter<{result: string}>({
        name: "bc_builder_bids_submitted_total",
        help: "Count of bid submission attempts by result",
        labelNames: ["result"],
      }),
      won: register.counter({
        name: "bc_builder_bids_won_total",
        help: "Count of blocks that committed to one of our bids",
      }),
      value: register.gauge({
        name: "bc_builder_bid_value_gwei",
        help: "Value of the last published bid in gwei",
      }),
      payloadValue: register.gauge<{source: string}>({
        name: "bc_builder_payload_value_gwei",
        help: "Value of the last built payload in gwei by source",
        labelNames: ["source"],
      }),
      submitTime: register.histogram({
        name: "bc_builder_bid_submit_time_seconds",
        help: "Time into the slot before the target slot at which the bid was published",
        buckets: [2, 4, 6, 8, 9, 10, 11, 12],
      }),
    },

    reveals: {
      total: register.counter<{result: string}>({
        name: "bc_builder_reveals_total",
        help: "Count of payload reveal attempts by result",
        labelNames: ["result"],
      }),
      time: register.histogram({
        name: "bc_builder_reveal_time_seconds",
        help: "Time into the slot at which the payload envelope was published",
        buckets: [0.25, 0.5, 1, 2, 3, 4, 6],
      }),
    },

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
