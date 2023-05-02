import {RegistryMetricCreator} from "../../metrics/utils/registryMetricCreator.js";

export type NetworkCoreMetrics = ReturnType<typeof createNetworkCoreMetrics>;

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function createNetworkCoreMetrics(register: RegistryMetricCreator) {
  return {
    register,

    // Peers

    peers: register.gauge({
      name: "libp2p_peers",
      help: "number of connected peers",
    }),
    peersByDirection: register.gauge<"direction">({
      name: "lodestar_peers_by_direction_count",
      help: "number of peers, labeled by direction",
      labelNames: ["direction"],
    }),
    peersByClient: register.gauge<"client">({
      name: "lodestar_peers_by_client_count",
      help: "number of peers, labeled by client",
      labelNames: ["client"],
    }),
    peerLongLivedAttnets: register.histogram({
      name: "lodestar_peer_long_lived_attnets_count",
      help: "Histogram of current count of long lived attnets of connected peers",
      buckets: [0, 4, 16, 32, 64],
    }),
    peerScoreByClient: register.histogram<"client">({
      name: "lodestar_app_peer_score",
      help: "Current peer score at lodestar app side",
      // Min score = -100, max score = 100, disconnect = -20, ban = -50
      buckets: [-100, -50, -20, 0, 25],
      labelNames: ["client"],
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
    peerConnectedEvent: register.gauge<"direction" | "status">({
      name: "lodestar_peer_connected_total",
      help: "Total number of peer:connected event, labeled by direction",
      labelNames: ["direction", "status"],
    }),
    peerDisconnectedEvent: register.gauge<"direction">({
      name: "lodestar_peer_disconnected_total",
      help: "Total number of peer:disconnected event, labeled by direction",
      labelNames: ["direction"],
    }),
    peerGoodbyeReceived: register.gauge<"reason">({
      name: "lodestar_peer_goodbye_received_total",
      help: "Total number of goodbye received, labeled by reason",
      labelNames: ["reason"],
    }),
    peerLongConnectionDisconnect: register.gauge<"reason">({
      name: "lodestar_peer_long_connection_disconnect_total",
      help: "For peers with long connection, track disconnect reason",
      labelNames: ["reason"],
    }),
    peerGoodbyeSent: register.gauge<"reason">({
      name: "lodestar_peer_goodbye_sent_total",
      help: "Total number of goodbye sent, labeled by reason",
      labelNames: ["reason"],
    }),
    peersRequestedToConnect: register.gauge({
      name: "lodestar_peers_requested_total_to_connect",
      help: "Prioritization results total peers count requested to connect",
    }),
    peersRequestedToDisconnect: register.gauge<"reason">({
      name: "lodestar_peers_requested_total_to_disconnect",
      help: "Prioritization results total peers count requested to disconnect",
      labelNames: ["reason"],
    }),
    peersRequestedSubnetsToQuery: register.gauge<"type">({
      name: "lodestar_peers_requested_total_subnets_to_query",
      help: "Prioritization results total subnets to query and discover peers in",
      labelNames: ["type"],
    }),
    peersRequestedSubnetsPeerCount: register.gauge<"type">({
      name: "lodestar_peers_requested_total_subnets_peers_count",
      help: "Prioritization results total peers in subnets to query and discover peers in",
      labelNames: ["type"],
    }),
    peersReportPeerCount: register.gauge<"reason">({
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

    discovery: {
      peersToConnect: register.gauge({
        name: "lodestar_discovery_peers_to_connect",
        help: "Current peers to connect count from discoverPeers requests",
      }),
      cachedENRsSize: register.gauge({
        name: "lodestar_discovery_cached_enrs_size",
        help: "Current size of the cachedENRs Set",
      }),
      findNodeQueryRequests: register.gauge<"action">({
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
      discoveredStatus: register.gauge<"status">({
        name: "lodestar_discovery_discovered_status_total_count",
        help: "Total count of status results of PeerDiscovery.onDiscovered() function",
        labelNames: ["status"],
      }),
      dialAttempts: register.gauge({
        name: "lodestar_discovery_total_dial_attempts",
        help: "Total dial attempts by peer discovery",
      }),
      dialTime: register.histogram<"status">({
        name: "lodestar_discovery_dial_time_seconds",
        help: "Time to dial peers in seconds",
        labelNames: ["status"],
        buckets: [0.1, 5, 60],
      }),
    },

    gossipPeer: {
      scoreByThreshold: register.gauge<"threshold">({
        name: "lodestar_gossip_peer_score_by_threshold_count",
        help: "Gossip peer score by threshold",
        labelNames: ["threshold"],
      }),
      meshPeersByClient: register.gauge<"client">({
        name: "lodestar_gossip_mesh_peers_by_client_count",
        help: "number of mesh peers, labeled by client",
        labelNames: ["client"],
      }),
      scoreByClient: register.histogram<"client">({
        name: "lodestar_gossip_score_by_client",
        help: "Gossip peer score by client",
        labelNames: ["client"],
        // based on gossipScoreThresholds and negativeGossipScoreIgnoreThreshold
        buckets: [-16000, -8000, -4000, -1000, 0, 5, 100],
      }),
      score: register.avgMinMax({
        name: "lodestar_gossip_score_avg_min_max",
        help: "Avg min max of all gossip peer scores",
      }),
    },
    gossipMesh: {
      peersByType: register.gauge<"type" | "fork">({
        name: "lodestar_gossip_mesh_peers_by_type_count",
        help: "Number of connected mesh peers per gossip type",
        labelNames: ["type", "fork"],
      }),
      peersByBeaconAttestationSubnet: register.gauge<"subnet" | "fork">({
        name: "lodestar_gossip_mesh_peers_by_beacon_attestation_subnet_count",
        help: "Number of connected mesh peers per beacon attestation subnet",
        labelNames: ["subnet", "fork"],
      }),
      peersBySyncCommitteeSubnet: register.gauge<"subnet" | "fork">({
        name: "lodestar_gossip_mesh_peers_by_sync_committee_subnet_count",
        help: "Number of connected mesh peers per sync committee subnet",
        labelNames: ["subnet", "fork"],
      }),
    },
    gossipTopic: {
      peersByType: register.gauge<"type" | "fork">({
        name: "lodestar_gossip_topic_peers_by_type_count",
        help: "Number of connected topic peers per gossip type",
        labelNames: ["type", "fork"],
      }),
      peersByBeaconAttestationSubnet: register.gauge<"subnet" | "fork">({
        name: "lodestar_gossip_topic_peers_by_beacon_attestation_subnet_count",
        help: "Number of connected topic peers per beacon attestation subnet",
        labelNames: ["subnet", "fork"],
      }),
      peersBySyncCommitteeSubnet: register.gauge<"subnet" | "fork">({
        name: "lodestar_gossip_topic_peers_by_sync_committee_subnet_count",
        help: "Number of connected topic peers per sync committee subnet",
        labelNames: ["subnet", "fork"],
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
      subscriptionsRandom: register.gauge({
        name: "lodestar_attnets_service_random_subscriptions_total",
        help: "Count of random subscriptions",
      }),
      subscribeSubnets: register.gauge<"subnet" | "src">({
        name: "lodestar_attnets_service_subscribe_subnets_total",
        help: "Count of subscribe_subnets calls",
        labelNames: ["subnet", "src"],
      }),
      unsubscribeSubnets: register.gauge<"subnet" | "src">({
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
      subscribeSubnets: register.gauge<"subnet">({
        name: "lodestar_syncnets_service_subscribe_subnets_total",
        help: "Count of syncnet subscribe_subnets calls",
        labelNames: ["subnet"],
      }),
      unsubscribeSubnets: register.gauge<"subnet">({
        name: "lodestar_syncnets_service_unsubscribe_subnets_total",
        help: "Count of syncnet unsubscribe_subnets calls",
        labelNames: ["subnet"],
      }),
    },

    reqResp: {
      rateLimitErrors: register.gauge<"method">({
        name: "beacon_reqresp_rate_limiter_errors_total",
        help: "Count rate limiter errors",
        labelNames: ["method"],
      }),
    },
  };
}
