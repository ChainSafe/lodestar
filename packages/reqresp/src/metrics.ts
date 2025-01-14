import {MetricsRegister} from "@lodestar/utils";

export type Metrics = ReturnType<typeof getMetrics>;

/**
 * A collection of metrics used throughout the Gossipsub behaviour.
 */
export function getMetrics(register: MetricsRegister) {
  // Using function style instead of class to prevent having to re-declare all MetricsPrometheus types.

  return {
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
