/* eslint-disable @typescript-eslint/naming-convention */
import {MetricsRegister} from "@lodestar/utils";

export type Metrics = ReturnType<typeof getMetrics>;

/**
 * A collection of metrics used throughout the Gossipsub behaviour.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function getMetrics(register: MetricsRegister) {
  // Using function style instead of class to prevent having to re-declare all MetricsPrometheus types.

  return {
    requestsSentTotalCount: register.counter<{protocol_id: string}>({
      // ethereum/beacon-metrics defined
      name: "libp2p_rpc_requests_sent_total",
      help: "Number of requests sent",
      labelNames: ["protocol_id"],
    }),
    requestsSentBytesTotalCount: register.counter<{protocol_id: string}>({
      // ethereum/beacon-metrics defined
      name: "libp2p_rpc_requests_bytes_sent_total",
      help: "Number of requests bytes sent",
      labelNames: ["protocol_id"],
    }),
    requestsReceivedTotalCount: register.counter<{protocol_id: string}>({
      // ethereum/beacon-metrics defined
      name: "libp2p_rpc_requests_received_total",
      help: "Number of requests received",
      labelNames: ["protocol_id"],
    }),
    requestsReceivedBytesTotalCount: register.counter<{protocol_id: string}>({
      // ethereum/beacon-metrics defined
      name: "libp2p_rpc_requests_bytes_received_total",
      help: "Number of requests bytes received",
      labelNames: ["protocol_id"],
    }),
    responsesSentTotalCount: register.counter<{protocol_id: string}>({
      // ethereum/beacon-metrics defined
      name: "libp2p_rpc_responses_sent_total",
      help: "Number of responses sent",
      labelNames: ["protocol_id"],
    }),
    responsesSentBytesTotalCount: register.counter<{protocol_id: string}>({
      // ethereum/beacon-metrics defined
      name: "libp2p_rpc_responses_bytes_sent_total",
      help: "Number of responses bytes sent",
      labelNames: ["protocol_id"],
    }),
    responsesReceivedTotalCount: register.counter<{protocol_id: string}>({
      // ethereum/beacon-metrics defined
      name: "libp2p_rpc_responses_received_total",
      help: "Number of responses received",
      labelNames: ["protocol_id"],
    }),
    responsesReceivedBytesTotalCount: register.counter<{protocol_id: string}>({
      // ethereum/beacon-metrics defined
      name: "libp2p_rpc_responses_bytes_received_total",
      help: "Number of responses bytes received",
      labelNames: ["protocol_id"],
    }),

    outgoingRequests: register.gauge<{method: string}>({
      name: "beacon_reqresp_outgoing_requests_total",
      help: "Counts total requests done per method",
      labelNames: ["method"],
    }),
    outgoingRequestRoundtripTime: register.histogram<{method: string}>({
      name: "beacon_reqresp_outgoing_request_roundtrip_time_seconds",
      help: "Histogram of outgoing requests round-trip time",
      labelNames: ["method"],
      // Spec sets RESP_TIMEOUT = 10 sec
      buckets: [0.1, 0.2, 0.5, 1, 5, 10, 15, 60],
    }),
    outgoingErrors: register.gauge<{method: string}>({
      name: "beacon_reqresp_outgoing_requests_error_total",
      help: "Counts total failed requests done per method",
      labelNames: ["method"],
    }),
    incomingRequests: register.gauge<{method: string}>({
      name: "beacon_reqresp_incoming_requests_total",
      help: "Counts total responses handled per method",
      labelNames: ["method"],
    }),
    incomingRequestHandlerTime: register.histogram<{method: string}>({
      name: "beacon_reqresp_incoming_request_handler_time_seconds",
      help: "Histogram of incoming requests internal handling time",
      labelNames: ["method"],
      // Spec sets RESP_TIMEOUT = 10 sec
      buckets: [0.1, 0.2, 0.5, 1, 5, 10],
    }),
    incomingErrors: register.gauge<{method: string}>({
      name: "beacon_reqresp_incoming_requests_error_total",
      help: "Counts total failed responses handled per method",
      labelNames: ["method"],
    }),
    outgoingResponseTTFB: register.histogram<{method: string}>({
      name: "beacon_reqresp_outgoing_response_ttfb_seconds",
      help: "Time to first byte (TTFB) for outgoing responses",
      labelNames: ["method"],
      // Spec sets TTFB_TIMEOUT = 5 sec
      buckets: [0.1, 1, 5],
    }),
    incomingResponseTTFB: register.histogram<{method: string}>({
      name: "beacon_reqresp_incoming_response_ttfb_seconds",
      help: "Time to first byte (TTFB) for incoming responses",
      labelNames: ["method"],
      // Spec sets TTFB_TIMEOUT = 5 sec
      buckets: [0.1, 1, 5],
    }),
    dialErrors: register.gauge({
      name: "beacon_reqresp_dial_errors_total",
      help: "Count total dial errors",
    }),
  };
}
