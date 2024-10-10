import {RegistryMetricCreator} from "../../metrics/utils/registryMetricCreator.js";
import {SubnetType} from "../metadata.js";
import {DiscoveredPeerStatus} from "../peers/discover.js";
import {SubnetSource} from "../subnets/attnetsService.js";

export type NetworkCoreMetrics = ReturnType<typeof createNetworkCoreMetrics>;

export function createNetworkCoreMetrics(register: RegistryMetricCreator) {
  return {
    register,

    // Peers

    peers: register.gauge({
      name: "libp2p_peers",
      help: "number of connected peers",
    }),
    peersByDirection: register.gauge<{direction: string}>({
      name: "lodestar_peers_by_direction_count",
      help: "number of peers, labeled by direction",
      labelNames: ["direction"],
    }),
    peersByClient: register.gauge<{client: string}>({
      name: "lodestar_peers_by_client_count",
      help: "number of peers, labeled by client",
      labelNames: ["client"],
    }),
    peerLongLivedAttnets: register.histogram({
      name: "lodestar_peer_long_lived_attnets_count",
      help: "Histogram of current count of long lived attnets of connected peers",
      buckets: [0, 4, 16, 32, 64],
    }),
    peerScoreByClient: register.histogram<{client: string}>({
      name: "lodestar_app_peer_score",
      help: "Current peer score at lodestar app side",
      // Min score = -100, max score = 100, disconnect = -20, ban = -50
      buckets: [-100, -50, -20, 0, 25],
      labelNames: ["client"],
    }),
    peerGossipScoreByClient: register.histogram<{client: string}>({
      name: "lodestar_gossip_score_by_client",
      help: "Gossip peer score by client",
      labelNames: ["client"],
      // based on gossipScoreThresholds and negativeGossipScoreIgnoreThreshold
      buckets: [-16000, -8000, -4000, -1000, 0, 5, 100],
    }),
    peerConnectionLength: register.histogram({
      name: "lodestar_peer_connection_seconds",
      help: "Current peer connection length in second",
      // Have good resolution on shorter times. After 1 day, don't count any longer
      //        5s 20s 1m  3m   10m  30m   1h    6h     24h
      buckets: [5, 20, 60, 180, 600, 1200, 3600, 21600, 86400],
    }),
    peersSync: register.gauge({
      name: "lodestar_peers_sync_count",
      help: "Current count of peers useful for sync",
    }),
    peerConnectedEvent: register.gauge<{direction: string; status: string}>({
      name: "lodestar_peer_connected_total",
      help: "Total number of peer:connected event, labeled by direction",
      labelNames: ["direction", "status"],
    }),
    peerDisconnectedEvent: register.gauge<{direction: string}>({
      name: "lodestar_peer_disconnected_total",
      help: "Total number of peer:disconnected event, labeled by direction",
      labelNames: ["direction"],
    }),
    peerGoodbyeReceived: register.gauge<{reason: string}>({
      name: "lodestar_peer_goodbye_received_total",
      help: "Total number of goodbye received, labeled by reason",
      labelNames: ["reason"],
    }),
    peerLongConnectionDisconnect: register.gauge<{reason: string}>({
      name: "lodestar_peer_long_connection_disconnect_total",
      help: "For peers with long connection, track disconnect reason",
      labelNames: ["reason"],
    }),
    peerGoodbyeSent: register.gauge<{reason: string}>({
      name: "lodestar_peer_goodbye_sent_total",
      help: "Total number of goodbye sent, labeled by reason",
      labelNames: ["reason"],
    }),
    peersRequestedToConnect: register.gauge({
      name: "lodestar_peers_requested_total_to_connect",
      help: "Prioritization results total peers count requested to connect",
    }),
    peersRequestedToDisconnect: register.gauge<{reason: string}>({
      name: "lodestar_peers_requested_total_to_disconnect",
      help: "Prioritization results total peers count requested to disconnect",
      labelNames: ["reason"],
    }),
    peersRequestedSubnetsToQuery: register.gauge<{type: SubnetType}>({
      name: "lodestar_peers_requested_total_subnets_to_query",
      help: "Prioritization results total subnets to query and discover peers in",
      labelNames: ["type"],
    }),
    peersRequestedSubnetsPeerCount: register.gauge<{type: SubnetType}>({
      name: "lodestar_peers_requested_total_subnets_peers_count",
      help: "Prioritization results total peers in subnets to query and discover peers in",
      labelNames: ["type"],
    }),
    peersReportPeerCount: register.gauge<{reason: string}>({
      name: "lodestar_peers_report_peer_count",
      help: "network.reportPeer count by reason",
      labelNames: ["reason"],
    }),
    peerManager: {
      heartbeatDuration: register.histogram({
        name: "lodestar_peer_manager_heartbeat_duration_seconds",
        help: "Peer manager heartbeat function duration in seconds",
        buckets: [0.001, 0.01, 0.1, 1],
      }),
    },
    leakedConnectionsCount: register.gauge({
      name: "lodestar_peer_manager_leaked_connections_count",
      help: "Total libp2p leaked connections detected by lodestar",
    }),

    discovery: {
      peersToConnect: register.gauge({
        name: "lodestar_discovery_peers_to_connect",
        help: "Current peers to connect count from discoverPeers requests",
      }),
      subnetPeersToConnect: register.gauge<{type: SubnetType}>({
        name: "lodestar_discovery_subnet_peers_to_connect",
        help: "Current peers to connect count from discoverPeers requests",
        labelNames: ["type"],
      }),
      subnetsToConnect: register.gauge<{type: SubnetType}>({
        name: "lodestar_discovery_subnets_to_connect",
        help: "Current subnets to connect count from discoverPeers requests",
        labelNames: ["type"],
      }),
      cachedENRsSize: register.gauge({
        name: "lodestar_discovery_cached_enrs_size",
        help: "Current size of the cachedENRs Set",
      }),
      findNodeQueryRequests: register.gauge<{action: string}>({
        name: "lodestar_discovery_find_node_query_requests_total",
        help: "Total count of find node queries started",
        labelNames: ["action"],
      }),
      findNodeQueryTime: register.histogram({
        name: "lodestar_discovery_find_node_query_time_seconds",
        help: "Time to complete a find node query in seconds in seconds",
        buckets: [5, 60],
      }),
      findNodeQueryEnrCount: register.gauge({
        name: "lodestar_discovery_find_node_query_enrs_total",
        help: "Total count of found ENRs in queries",
      }),
      discoveredStatus: register.gauge<{status: DiscoveredPeerStatus}>({
        name: "lodestar_discovery_discovered_status_total_count",
        help: "Total count of status results of PeerDiscovery.onDiscovered() function",
        labelNames: ["status"],
      }),
      dialAttempts: register.gauge({
        name: "lodestar_discovery_total_dial_attempts",
        help: "Total dial attempts by peer discovery",
      }),
      dialTime: register.histogram<{status: string}>({
        name: "lodestar_discovery_dial_time_seconds",
        help: "Time to dial peers in seconds",
        labelNames: ["status"],
        buckets: [0.1, 5, 60],
      }),
    },

    reqResp: {
      rateLimitErrors: register.gauge<{method: string}>({
        name: "beacon_reqresp_rate_limiter_errors_total",
        help: "Count rate limiter errors",
        labelNames: ["method"],
      }),
    },

    discv5: {
      decodeEnrAttemptCount: register.counter({
        name: "lodestar_discv5_decode_enr_attempt_count",
        help: "Count of total attempts to decode enrs",
      }),
      decodeEnrErrorCount: register.counter({
        name: "lodestar_discv5_decode_enr_error_count",
        help: "Count of total errors attempting to decode enrs",
      }),
    },

    attnetsService: {
      committeeSubnets: register.gauge({
        name: "lodestar_attnets_service_committee_subnets_total",
        help: "Count of committee subnets",
      }),
      subscriptionsCommittee: register.gauge({
        name: "lodestar_attnets_service_committee_subscriptions_total",
        help: "Count of committee subscriptions",
      }),
      subscriptionsCommitteeMeshPeers: register.histogram<{subnet: number}>({
        name: "lodestar_attnets_service_committee_subscriptions_mesh_peers",
        help: "Histogram of mesh peers per committee subscription",
        labelNames: ["subnet"],
        // Dlow = 6, D = 8, DHi = 12 plus 2 more buckets
        buckets: [0, 4, 6, 8, 12],
      }),
      subscriptionsCommitteeTimeToStableMesh: register.histogram<{subnet: number}>({
        name: "lodestar_attnets_service_committee_subscriptions_time_to_stable_mesh_seconds",
        help: "Histogram of time until committee subscription is considered healthy (>= 6 mesh peers)",
        labelNames: ["subnet"],
        // we subscribe 2 slots = 24s before aggregator duty
        buckets: [0, 6, 12, 18, 24],
      }),
      subscriptionsRandom: register.gauge({
        name: "lodestar_attnets_service_random_subscriptions_total",
        help: "Count of random subscriptions",
      }),
      longLivedSubscriptions: register.gauge({
        name: "lodestar_attnets_service_long_lived_subscriptions_total",
        help: "Count of long lived subscriptions",
      }),
      subscribeSubnets: register.gauge<{subnet: number; src: SubnetSource}>({
        name: "lodestar_attnets_service_subscribe_subnets_total",
        help: "Count of subscribe_subnets calls",
        labelNames: ["subnet", "src"],
      }),
      unsubscribeSubnets: register.gauge<{subnet: number; src: SubnetSource}>({
        name: "lodestar_attnets_service_unsubscribe_subnets_total",
        help: "Count of unsubscribe_subnets calls",
        labelNames: ["subnet", "src"],
      }),
      aggregatorSlotSubnetCount: register.gauge({
        name: "lodestar_attnets_service_aggregator_slot_subnet_total",
        help: "Count of aggregator per slot and subnet",
      }),
    },

    syncnetsService: {
      subscriptionsCommittee: register.gauge({
        name: "lodestar_syncnets_service_committee_subscriptions_total",
        help: "Count of syncnet committee subscriptions",
      }),
      subscribeSubnets: register.gauge<{subnet: number}>({
        name: "lodestar_syncnets_service_subscribe_subnets_total",
        help: "Count of syncnet subscribe_subnets calls",
        labelNames: ["subnet"],
      }),
      unsubscribeSubnets: register.gauge<{subnet: number}>({
        name: "lodestar_syncnets_service_unsubscribe_subnets_total",
        help: "Count of syncnet unsubscribe_subnets calls",
        labelNames: ["subnet"],
      }),
    },
  };
}

export type NetworkCoreWorkerMetrics = ReturnType<typeof getNetworkCoreWorkerMetrics>;

export function getNetworkCoreWorkerMetrics(register: RegistryMetricCreator) {
  return {
    reqRespBridgeRespCallerPending: register.gauge({
      name: "lodestar_network_worker_reqresp_bridge_caller_pending_count",
      help: "Current count of pending elements in respBridgeCaller",
    }),
    networkWorkerWireEventsOnWorkerThreadLatency: register.histogram<{eventName: string}>({
      name: "lodestar_network_worker_wire_events_on_worker_thread_latency_seconds",
      help: "Latency in seconds to transmit network events to worker thread across parent port",
      labelNames: ["eventName"],
      buckets: [0.001, 0.003, 0.01, 0.03, 0.1],
    }),
  };
}
