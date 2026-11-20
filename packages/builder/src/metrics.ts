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

export enum BidResult {
  dryRun = "dry_run",
  prepared = "prepared",
  published = "published",
  noProposerPreferences = "no_proposer_preferences",
  inactive = "inactive",
  lowBalance = "low_balance",
  policyDeclined = "policy_declined",
  error = "error",
}

export enum RevealResult {
  published = "published",
  unknownPayload = "unknown_payload",
  late = "late",
  withheld = "withheld",
  error = "error",
}

export enum BidRequestResult {
  served = "served",
  noBid = "no_bid",
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
    builderStatus: register.gauge({
      name: "bc_builder_status",
      help: "Current builder status: pending=0, active=1, exited=2",
    }),

    builderBalance: register.gauge({
      name: "bc_builder_balance_gwei",
      help: "Current builder balance in gwei",
    }),

    bids: {
      total: register.gauge<{result: BidResult}>({
        name: "bc_builder_bids_total",
        help: "Total count of bid attempts by result",
        labelNames: ["result"],
      }),
      won: register.gauge({
        name: "bc_builder_bids_won_total",
        help: "Total count of imported blocks that selected one of our bids",
      }),
    },

    reveals: {
      total: register.gauge<{result: RevealResult}>({
        name: "bc_builder_reveals_total",
        help: "Total count of payload reveal attempts by result",
        labelNames: ["result"],
      }),
    },

    proposerPreferences: {
      recovered: register.gauge<{source: string}>({
        name: "bc_builder_proposer_preferences_recovered_total",
        help: "Total count of proposer preferences first learned by polling a beacon node, by source",
        labelNames: ["source"],
      }),
      fetchErrors: register.gauge<{source: string}>({
        name: "bc_builder_proposer_preferences_fetch_errors_total",
        help: "Total count of failed proposer preferences polls by source",
        labelNames: ["source"],
      }),
    },

    api: {
      bidRequests: register.gauge<{result: BidRequestResult}>({
        name: "bc_builder_api_bid_requests_total",
        help: "Total count of authenticated bid requests received over the builder API by result",
        labelNames: ["result"],
      }),
      blockSubmissions: register.gauge({
        name: "bc_builder_api_block_submissions_total",
        help: "Total count of valid signed beacon blocks received over the builder API",
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
