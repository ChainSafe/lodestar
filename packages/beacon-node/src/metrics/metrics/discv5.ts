import {RegistryMetricCreator} from "../utils/registryMetricCreator.js";

export type IDiscv5Metrics = ReturnType<typeof createDiscv5Metrics>;

/**
 * Extra Lodestar custom metrics
 */
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/explicit-function-return-type
export function createDiscv5Metrics(register: RegistryMetricCreator) {
  return {
    kadTableSize: register.gauge({
      name: "lodestar_discv5_kad_table_size",
      help: "Total size of the discv5 kad table",
    }),
    lookupCount: register.gauge({
      name: "lodestar_discv5_lookup_count",
      help: "Total count of discv5 lookups",
    }),
    activeSessionCount: register.gauge({
      name: "lodestar_discv5_active_session_count",
      help: "Count of the discv5 active sessions",
    }),
    connectedPeerCount: register.gauge({
      name: "lodestar_discv5_connected_peer_count",
      help: "Count of the discv5 connected peers",
    }),
    sentMessageCount: register.gauge<"type">({
      name: "lodestar_discv5_sent_message_count",
      help: "Count of the discv5 messages sent by message type",
      labelNames: ["type"],
    }),
    rcvdMessageCount: register.gauge<"type">({
      name: "lodestar_discv5_rcvd_message_count",
      help: "Count of the discv5 messages received by message type",
      labelNames: ["type"],
    }),
    rateLimitHitIP: register.gauge({
      name: "lodestar_discv5_rate_limit_hit_ip",
      help: "Total count of rate limit hits by IP",
    }),
    rateLimitHitTotal: register.gauge({
      name: "lodestar_discv5_rate_limit_hit_total",
      help: "Total count of rate limit hits by total requests",
    }),
  };
}
