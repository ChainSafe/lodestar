import {GossipType} from "../../network/gossip/interface.js";
import {CannotAcceptWorkReason, ReprocessRejectReason} from "../../network/processor/index.js";
import {RegistryMetricCreator} from "../utils/registryMetricCreator.js";

export type NetworkJsMetrics = ReturnType<typeof createNetworkJsMetrics>;

export function createNetworkJsMetrics(register: RegistryMetricCreator) {
  return {
    gossipValidationQueue: {
      length: register.gauge<{topic: GossipType}>({
        name: "lodestar_gossip_validation_queue_length",
        help: "Count of total gossip validation queue length",
        labelNames: ["topic"],
      }),
      keySize: register.gauge<{topic: GossipType}>({
        name: "lodestar_gossip_validation_queue_key_size",
        help: "Count of total gossip validation queue key size",
        labelNames: ["topic"],
      }),
      droppedJobs: register.gauge<{topic: GossipType}>({
        name: "lodestar_gossip_validation_queue_dropped_jobs_total",
        help: "Count of total gossip validation queue dropped jobs",
        labelNames: ["topic"],
      }),

      concurrency: register.gauge<{topic: GossipType}>({
        name: "lodestar_gossip_validation_queue_concurrency",
        help: "Current count of jobs being run on network processor for topic",
        labelNames: ["topic"],
      }),
      // this metric links to the beacon_attestation topic only as this is the only topics that are batch
      keyAge: register.histogram({
        name: "lodestar_gossip_validation_queue_key_age_seconds",
        help: "Age of the first item of each key in the indexed queues in seconds",
        buckets: [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 5],
      }),
      queueTime: register.histogram<{topic: GossipType}>({
        name: "lodestar_gossip_validation_queue_time_seconds",
        help: "Total time an item stays in queue until it is processed in seconds",
        labelNames: ["topic"],
        buckets: [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 5],
      }),
    },
    networkProcessor: {
      executeWorkCalls: register.gauge({
        name: "lodestar_network_processor_execute_work_calls_total",
        help: "Total calls to network processor execute work fn",
      }),
      canNotAcceptWork: register.gauge<{reason: CannotAcceptWorkReason}>({
        name: "lodestar_network_processor_can_not_accept_work_total",
        help: "Total times network processor can not accept work on executeWork",
        labelNames: ["reason"],
      }),
    },
    networkWorkerHandler: {
      reqRespBridgeReqCallerPending: register.gauge({
        name: "lodestar_network_worker_handler_reqresp_bridge_req_caller_pending_count",
        help: "Current count of pending items in reqRespBridgeReqCaller data structure",
      }),
    },
    networkWorkerWireEventsOnMainThreadLatency: register.histogram<{eventName: string}>({
      name: "lodestar_network_worker_wire_events_on_main_thread_latency_seconds",
      help: "Latency in seconds to transmit network events to main thread across worker port",
      labelNames: ["eventName"],
      buckets: [0.001, 0.003, 0.01, 0.03, 0.1],
    }),
    awaitingBlockGossipMessages: {
      queue: register.gauge<{topic: GossipType}>({
        name: "lodestar_awaiting_block_gossip_messages_total",
        help: "Total gossip messages queued while waiting for an unknown block",
        labelNames: ["topic"],
      }),
      countPerSlot: register.gauge({
        name: "lodestar_awaiting_block_gossip_messages_per_slot_total",
        help: "Current gossip messages waiting for an unknown block",
      }),
      resolve: register.gauge<{topic: GossipType}>({
        name: "lodestar_awaiting_block_gossip_messages_resolve_total",
        help: "Total number of gossip messages are reprocessed",
        labelNames: ["topic"],
      }),
      waitSecBeforeResolve: register.gauge<{topic: GossipType}>({
        name: "lodestar_awaiting_block_gossip_messages_wait_time_resolve_seconds",
        help: "Time to wait for unknown block in seconds",
        labelNames: ["topic"],
      }),
      // having 2 labels here is not great for performance, however it's rarely happening and having the reason label is important for debugging
      reject: register.gauge<{reason: ReprocessRejectReason; topic: GossipType}>({
        name: "lodestar_awaiting_block_gossip_messages_reject_total",
        help: "Total number of gossip messages are rejected to reprocess",
        labelNames: ["reason", "topic"],
      }),
      waitSecBeforeReject: register.gauge<{reason: ReprocessRejectReason; topic: GossipType}>({
        name: "lodestar_awaiting_block_gossip_messages_wait_time_reject_seconds",
        help: "Time to wait for unknown block before being rejected",
        labelNames: ["reason", "topic"],
      }),
    },
    awaitingPayloadGossipMessages: {
      queue: register.gauge<{topic: GossipType}>({
        name: "lodestar_awaiting_payload_gossip_messages_total",
        help: "Total gossip messages queued while waiting for an unknown payload",
        labelNames: ["topic"],
      }),
      countPerSlot: register.gauge({
        name: "lodestar_awaiting_payload_gossip_messages_per_slot_total",
        help: "Current gossip messages waiting for an unknown payload",
      }),
      resolve: register.gauge<{topic: GossipType}>({
        name: "lodestar_awaiting_payload_gossip_messages_resolve_total",
        help: "Total number of gossip messages are reprocessed",
        labelNames: ["topic"],
      }),
      waitSecBeforeResolve: register.gauge<{topic: GossipType}>({
        name: "lodestar_awaiting_payload_gossip_messages_wait_time_resolve_seconds",
        help: "Time to wait for unknown payload in seconds",
        labelNames: ["topic"],
      }),
      // having 2 labels here is not great for performance, however it's rarely happening and having the reason label is important for debugging
      reject: register.gauge<{reason: ReprocessRejectReason; topic: GossipType}>({
        name: "lodestar_awaiting_payload_gossip_messages_reject_total",
        help: "Total number of gossip messages are rejected to reprocess",
        labelNames: ["reason", "topic"],
      }),
      waitSecBeforeReject: register.gauge<{reason: ReprocessRejectReason; topic: GossipType}>({
        name: "lodestar_awaiting_payload_gossip_messages_wait_time_reject_seconds",
        help: "Time to wait for unknown payload before being rejected",
        labelNames: ["reason", "topic"],
      }),
    },
  };
}
