import {SubnetID} from "@lodestar/types";
import {RegistryMetricCreator} from "../../metrics/utils/registryMetricCreator.js";
import {Libp2pError} from "../libp2p/error.js";
import {SubnetType} from "../metadata.js";
import {DiscoveredPeerStatus, NotDialReason} from "../peers/discover.js";
import {PeerRequestedSubnetType} from "../peers/peerManager.js";
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
    peerColumnGroupCount: register.histogram({
      name: "lodestar_peer_column_group_count",
      help: "Histogram of current count of column groups of connected peers",
      buckets: [0, 4, 8, 16, 32, 64, 128],
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
    peersRequestedSubnetsToQuery: register.gauge<{type: PeerRequestedSubnetType}>({
      name: "lodestar_peers_requested_total_subnets_to_query",
      help: "Prioritization results total subnets to query and discover peers in",
      labelNames: ["type"],
    }),
    peersRequestedSubnetsPeerCount: register.gauge<{type: PeerRequestedSubnetType}>({
      name: "lodestar_peers_requested_total_subnets_peers_count",
      help: "Prioritization results total peers in subnets to query and discover peers in",
      labelNames: ["type"],
    }),
    peersReportPeerCount: register.gauge<{reason: string}>({
      name: "lodestar_peers_report_peer_count",
      help: "network.reportPeer count by reason",
      labelNames: ["reason"],
    }),
    peerCountPerSamplingGroup: register.gauge<{groupIndex: number}>({
      name: "lodestar_peer_count_per_sampling_group",
      help: "Current count of peers per sampling group",
      labelNames: ["groupIndex"],
    }),
    peerManager: {
      heartbeatDuration: register.histogram({
        name: "lodestar_peer_manager_heartbeat_duration_seconds",
        help: "Peer manager heartbeat function duration in seconds",
        buckets: [0.001, 0.01, 0.1, 1],
      }),
      starved: register.gauge({
        name: "lodestar_peer_manager_starved_bool",
        help: "Whether lodestar is starved of data while syncing",
      }),
      /**
       * Core selection/pruning phase of the heartbeat, split out of heartbeatDuration so it
       * can be attributed on its own. Divide by peersEvaluated for time-per-peer.
       */
      prioritizePeersDuration: register.histogram({
        name: "lodestar_peer_manager_prioritize_peers_seconds",
        help: "prioritizePeers function duration in seconds, the core peer selection/pruning algorithm",
        buckets: [0.0005, 0.001, 0.005, 0.01, 0.05, 0.1],
      }),
      /**
       * Score decay + map prune over every tracked peer, split out of heartbeatDuration.
       * This loop iterates the whole score store, so divide by scoreMapSize (not
       * peersEvaluated) for time-per-peer.
       */
      scoreUpdateDuration: register.histogram({
        name: "lodestar_peer_score_update_seconds",
        help: "Peer score store update (decay + prune over all peers) duration in seconds",
        buckets: [0.0005, 0.001, 0.005, 0.01, 0.05, 0.1],
      }),
      /**
       * Denominator for prioritizePeersDuration: it scales with the number of connected
       * healthy peers, so time-per-peer (prioritizePeersDuration / this) is the comparable
       * figure. For scoreUpdateDuration use scoreMapSize instead.
       */
      peersEvaluated: register.histogram({
        name: "lodestar_peer_manager_peers_evaluated_count",
        help: "Number of connected healthy peers evaluated by prioritizePeers per heartbeat, denominator for prioritize_peers_seconds",
        buckets: [0, 25, 50, 75, 100, 150, 200],
      }),
      /**
       * Every peer the manager intends to disconnect. Covers both the top-of-heartbeat
       * bad-score disconnects ("banned"/"score_too_low") and the prioritization reasons;
       * the older peersRequestedToDisconnect gauge only recorded the latter. Counts intent,
       * not completion (goodbye is fire-and-forget).
       */
      peersPruned: register.counter<{reason: string}>({
        name: "lodestar_peer_manager_peers_pruned_total",
        help: "Total peers the peer manager intends to disconnect, labeled by reason (incl. bad-score and prioritization reasons)",
        labelNames: ["reason"],
      }),
      /**
       * Actual peer count per active subnet, to check the min-peers-per-subnet invariant.
       * Buckets straddle the target (TARGET_SUBNET_PEERS = 6).
       */
      peersPerActiveSubnet: register.histogram<{type: SubnetType}>({
        name: "lodestar_peer_manager_peers_per_active_subnet",
        help: "Histogram of connected peer count per active subnet, labeled by subnet type",
        labelNames: ["type"],
        buckets: [0, 2, 4, 6, 8, 12],
      }),
      /**
       * Live outbound ratio, to check the OUTBOUND_PEERS_RATIO (10%) invariant (issue #2215).
       * Denominator is connected healthy peers (banned/disconnected already removed).
       */
      outboundPeersRatio: register.gauge({
        name: "lodestar_peer_manager_outbound_peers_ratio",
        help: "Ratio of outbound peers to total connected healthy peers, verifies the outbound peers invariant",
      }),
      /**
       * Score state crossings (Healthy/Disconnected/Banned). Sensitive to the decay formula,
       * thresholds, and gossip-score weighting.
       */
      scoreStateTransitions: register.counter<{from: string; to: string}>({
        name: "lodestar_peer_score_state_transitions_total",
        help: "Total peer score state transitions, labeled by from and to state (Healthy/Disconnected/Banned)",
        labelNames: ["from", "to"],
      }),
      /**
       * Entry count of the score store (not bytes). Reflects the prune-to-MAX_ENTRIES /
       * SCORE_THRESHOLD retention logic. Also the denominator for scoreUpdateDuration
       * time-per-peer (that loop iterates the whole store, not just connected peers).
       */
      scoreMapSize: register.gauge({
        name: "lodestar_peer_manager_score_map_size",
        help: "Current number of entries in the peer score store",
      }),
      /**
       * Entry count of the connectedPeers map (not bytes). Should track libp2p_peers; a
       * persistent gap indicates the connection leak guarded by leakedConnectionsCount.
       */
      connectedPeersMapSize: register.gauge({
        name: "lodestar_peer_manager_connected_peers_map_size",
        help: "Current number of entries in the peer manager connectedPeers map",
      }),
      /**
       * assertPeerRelevance outcome per Status exchange: "relevant", an irrelevant reason
       * code, or "error". Fires on every status evaluation (inbound requests and our own
       * requestStatus responses both route through onStatus).
       */
      relevanceCheck: register.counter<{result: string}>({
        name: "lodestar_peer_relevance_check_total",
        help: "Total peer relevance checks on Status, labeled by result (relevant or irrelevant reason code)",
        labelNames: ["result"],
      }),
      /**
       * Penalties dropped by the REPEAT_PENALTY_COOLDOWN_MS rate limit, labeled by action name.
       * A sustained rate here means a failure source is firing far faster than once per cooldown,
       * i.e. the peer set would have been scored down on a single incident without the limit.
       */
      penaltiesSuppressed: register.counter<{reason: string}>({
        name: "lodestar_peer_penalties_suppressed_total",
        help: "Total peer score penalties suppressed by the repeat penalty cooldown, labeled by action name",
        labelNames: ["reason"],
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
      custodyGroupPeersToConnect: register.gauge({
        name: "lodestar_discovery_custody_group_peers_to_connect",
        help: "Current PeerDAS custodyGroup peers to connect count from discoverPeers requests",
      }),
      subnetsToConnect: register.gauge<{type: SubnetType}>({
        name: "lodestar_discovery_subnets_to_connect",
        help: "Current subnets to connect count from discoverPeers requests",
        labelNames: ["type"],
      }),
      custodyGroupsToConnect: register.gauge({
        name: "lodestar_discovery_custody_groups_to_connect",
        help: "PeerDAS custodyGroups to connect count from discoverPeers requests",
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
      notDialReason: register.gauge<{reason: NotDialReason}>({
        name: "lodestar_discovery_not_dial_reason_total_count",
        help: "Total count of not dial reasons",
        labelNames: ["reason"],
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
      dialError: register.gauge<{reason: Libp2pError}>({
        name: "lodestar_discovery_dial_error_total_count",
        help: "Total count of dial errors",
        labelNames: ["reason"],
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
      subscriptionsCommitteeMeshPeers: register.histogram<{subnet: SubnetID}>({
        name: "lodestar_attnets_service_committee_subscriptions_mesh_peers",
        help: "Histogram of mesh peers per committee subscription",
        labelNames: ["subnet"],
        // Dlow = 6, D = 8, DHi = 12 plus 2 more buckets
        buckets: [0, 4, 6, 8, 12],
      }),
      subscriptionsCommitteeTimeToStableMesh: register.histogram<{subnet: SubnetID}>({
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
      subscribeSubnets: register.gauge<{subnet: SubnetID; src: SubnetSource}>({
        name: "lodestar_attnets_service_subscribe_subnets_total",
        help: "Count of subscribe_subnets calls",
        labelNames: ["subnet", "src"],
      }),
      unsubscribeSubnets: register.gauge<{subnet: SubnetID; src: SubnetSource}>({
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
      subscribeSubnets: register.gauge<{subnet: SubnetID}>({
        name: "lodestar_syncnets_service_subscribe_subnets_total",
        help: "Count of syncnet subscribe_subnets calls",
        labelNames: ["subnet"],
      }),
      unsubscribeSubnets: register.gauge<{subnet: SubnetID}>({
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
