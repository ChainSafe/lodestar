import {RegistryMetricCreator} from "../utils/registryMetricCreator.js";

export type IBeaconMetrics = ReturnType<typeof createBeaconMetrics>;

/**
 * Metrics from:
 * https://github.com/ethereum/beacon-metrics/ and
 * https://hackmd.io/D5FmoeFZScim_squBFl8oA
 */
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/explicit-function-return-type
export function createBeaconMetrics(register: RegistryMetricCreator) {
  return {
    // From https://github.com/ethereum/beacon-metrics/blob/master/metrics.md
    // Interop-metrics

    peers: register.gauge({
      name: "libp2p_peers",
      help: "number of connected peers",
    }),
    headSlot: register.gauge({
      name: "beacon_head_slot",
      help: "slot of the head block of the beacon chain",
    }),
    finalizedEpoch: register.gauge({
      name: "beacon_finalized_epoch",
      help: "current finalized epoch",
    }),
    currentJustifiedEpoch: register.gauge({
      name: "beacon_current_justified_epoch",
      help: "current justified epoch",
    }),
    previousJustifiedEpoch: register.gauge({
      name: "beacon_previous_justified_epoch",
      help: "previous justified epoch",
    }),
    currentActiveValidators: register.gauge({
      name: "beacon_current_active_validators",
      help: "number of active validators in current epoch",
    }),
    reorgEventsTotal: register.gauge({
      name: "beacon_reorgs_total",
      help: "number of chain reorganizations",
    }),
    processedDepositsTotal: register.gauge({
      name: "beacon_processed_deposits_total",
      help: "number of total deposits included on chain",
    }),

    // From https://github.com/ethereum/beacon-metrics/blob/master/metrics.md
    // Additional Metrics
    // TODO: Implement

    currentValidators: register.gauge<"status">({
      name: "beacon_current_validators",
      labelNames: ["status"],
      help: "number of validators in current epoch",
    }),

    // Non-spec'ed

    forkChoice: {
      findHead: register.histogram({
        name: "beacon_fork_choice_find_head_seconds",
        help: "Time taken to find head in seconds",
        buckets: [0.1, 1, 10],
      }),
      requests: register.gauge({
        name: "beacon_fork_choice_requests_total",
        help: "Count of occasions where fork choice has tried to find a head",
      }),
      errors: register.gauge({
        name: "beacon_fork_choice_errors_total",
        help: "Count of occasions where fork choice has returned an error when trying to find a head",
      }),
      changedHead: register.gauge({
        name: "beacon_fork_choice_changed_head_total",
        help: "Count of occasions fork choice has found a new head",
      }),
      reorg: register.gauge({
        name: "beacon_fork_choice_reorg_total",
        help: "Count of occasions fork choice has switched to a different chain",
      }),
      reorgDistance: register.histogram({
        name: "beacon_fork_choice_reorg_distance",
        help: "Histogram of re-org distance",
        // We need high resolution in the low range, since re-orgs are a rare but critical event.
        // Add buckets up to 100 to capture high depth re-orgs. Above 100 things are going really bad.
        buckets: [1, 2, 3, 5, 7, 10, 20, 30, 50, 100],
      }),
    },

    parentBlockDistance: register.histogram({
      name: "beacon_imported_block_parent_distance",
      help: "Histogram of distance to parent block of valid imported blocks",
      buckets: [1, 2, 3, 5, 7, 10, 20, 30, 50, 100],
    }),

    reqResp: {
      outgoingRequests: register.gauge<"method">({
        name: "beacon_reqresp_outgoing_requests_total",
        help: "Counts total requests done per method",
        labelNames: ["method"],
      }),
      outgoingRequestRoundtripTime: register.histogram<"method">({
        name: "beacon_reqresp_outgoing_request_roundtrip_time_seconds",
        help: "Histogram of outgoing requests round-trip time",
        labelNames: ["method"],
        buckets: [0.1, 0.2, 0.5, 1, 5, 15, 60],
      }),
      outgoingErrors: register.gauge<"method">({
        name: "beacon_reqresp_outgoing_requests_error_total",
        help: "Counts total failed requests done per method",
        labelNames: ["method"],
      }),
      incomingRequests: register.gauge<"method">({
        name: "beacon_reqresp_incoming_requests_total",
        help: "Counts total responses handled per method",
        labelNames: ["method"],
      }),
      incomingRequestHandlerTime: register.histogram<"method">({
        name: "beacon_reqresp_incoming_request_handler_time_seconds",
        help: "Histogram of incoming requests internal handling time",
        labelNames: ["method"],
        buckets: [0.1, 0.2, 0.5, 1, 5],
      }),
      incomingErrors: register.gauge<"method">({
        name: "beacon_reqresp_incoming_requests_error_total",
        help: "Counts total failed responses handled per method",
        labelNames: ["method"],
      }),
      dialErrors: register.gauge({
        name: "beacon_reqresp_dial_errors_total",
        help: "Count total dial errors",
      }),
      rateLimitErrors: register.gauge<"tracker">({
        name: "beacon_reqresp_rate_limiter_errors_total",
        help: "Count rate limiter errors",
        labelNames: ["tracker"],
      }),
    },

    blockProductionTime: register.histogram({
      name: "beacon_block_production_seconds",
      help: "Full runtime of block production",
      buckets: [0.1, 1, 10],
    }),
    blockProductionRequests: register.gauge({
      name: "beacon_block_production_requests_total",
      help: "Count of all block production requests",
    }),
    blockProductionSuccess: register.gauge({
      name: "beacon_block_production_successes_total",
      help: "Count of blocks successfully produced",
    }),

    blockPayload: {
      payloadAdvancePrepTime: register.histogram({
        name: "beacon_block_payload_prepare_time",
        help: "Time for perparing payload in advance",
        buckets: [0.1, 1, 3, 5, 10],
      }),
      payloadFetchedTime: register.histogram<"prepType">({
        name: "beacon_block_payload_fetched_time",
        help: "Time to fetch the payload from EL",
        labelNames: ["prepType"],
      }),
      emptyPayloads: register.gauge<"prepType">({
        name: "beacon_block_payload_empty_total",
        help: "Count of payload with empty transactions",
        labelNames: ["prepType"],
      }),
      payloadFetchErrors: register.gauge({
        name: "beacon_block_payload_errors_total",
        help: "Count of errors while fetching payloads",
      }),
    },

    // Non-spec'ed
    clockSlot: register.gauge({
      name: "beacon_clock_slot",
      help: "Current clock slot",
    }),
  };
}
