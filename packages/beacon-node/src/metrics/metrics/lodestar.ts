import {allForks} from "@lodestar/types";
import {RegistryMetricCreator} from "../utils/registryMetricCreator.js";
import {LodestarMetadata} from "../options.js";

export type LodestarMetrics = ReturnType<typeof createLodestarMetrics>;

/**
 * Extra Lodestar custom metrics
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function createLodestarMetrics(
  register: RegistryMetricCreator,
  metadata?: LodestarMetadata,
  anchorState?: Pick<allForks.BeaconState, "genesisTime">
) {
  if (metadata) {
    register.static<keyof LodestarMetadata>({
      name: "lodestar_version",
      help: "Lodestar version",
      value: metadata,
    });
  }

  // Initial static metrics
  if (anchorState) {
    register
      .gauge({
        name: "lodestar_genesis_time",
        help: "Genesis time in seconds",
      })
      .set(anchorState.genesisTime);
  }

  return {
    // Peers

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

    gossipValidationAccept: register.gauge<"topic">({
      name: "lodestar_gossip_validation_accept_total",
      help: "Count of total gossip validation accept",
      labelNames: ["topic"],
    }),
    gossipValidationIgnore: register.gauge<"topic">({
      name: "lodestar_gossip_validation_ignore_total",
      help: "Count of total gossip validation ignore",
      labelNames: ["topic"],
    }),
    gossipValidationReject: register.gauge<"topic">({
      name: "lodestar_gossip_validation_reject_total",
      help: "Count of total gossip validation reject",
      labelNames: ["topic"],
    }),
    gossipValidationError: register.gauge<"topic" | "error">({
      name: "lodestar_gossip_validation_error_total",
      help: "Count of total gossip validation errors detailed",
      labelNames: ["topic", "error"],
    }),

    gossipValidationQueueLength: register.gauge<"topic">({
      name: "lodestar_gossip_validation_queue_length",
      help: "Count of total gossip validation queue length",
      labelNames: ["topic"],
    }),
    gossipValidationQueueDroppedJobs: register.gauge<"topic">({
      name: "lodestar_gossip_validation_queue_dropped_jobs_total",
      help: "Count of total gossip validation queue dropped jobs",
      labelNames: ["topic"],
    }),
    gossipValidationQueueJobTime: register.histogram<"topic">({
      name: "lodestar_gossip_validation_queue_job_time_seconds",
      help: "Time to process gossip validation queue job in seconds",
      labelNames: ["topic"],
      buckets: [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10],
    }),
    gossipValidationQueueJobWaitTime: register.histogram<"topic">({
      name: "lodestar_gossip_validation_queue_job_wait_time_seconds",
      help: "Time from job added to the queue to starting the job in seconds",
      labelNames: ["topic"],
      buckets: [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10],
    }),
    gossipValidationQueueConcurrency: register.gauge<"topic">({
      name: "lodestar_gossip_validation_queue_concurrency",
      help: "Current concurrency of gossip validation queue",
      labelNames: ["topic"],
    }),

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

    regenQueue: {
      length: register.gauge({
        name: "lodestar_regen_queue_length",
        help: "Count of total regen queue length",
      }),
      droppedJobs: register.gauge({
        name: "lodestar_regen_queue_dropped_jobs_total",
        help: "Count of total regen queue dropped jobs",
      }),
      jobTime: register.histogram({
        name: "lodestar_regen_queue_job_time_seconds",
        help: "Time to process regen queue job in seconds",
        buckets: [0.01, 0.1, 1, 10, 100],
      }),
      jobWaitTime: register.histogram({
        name: "lodestar_regen_queue_job_wait_time_seconds",
        help: "Time from job added to the regen queue to starting in seconds",
        buckets: [0.01, 0.1, 1, 10, 100],
      }),
      concurrency: register.gauge({
        name: "lodestar_regen_queue_concurrency",
        help: "Current concurrency of regen queue",
      }),
    },

    blockProcessorQueue: {
      length: register.gauge({
        name: "lodestar_block_processor_queue_length",
        help: "Count of total block processor queue length",
      }),
      droppedJobs: register.gauge({
        name: "lodestar_block_processor_queue_dropped_jobs_total",
        help: "Count of total block processor queue dropped jobs",
      }),
      jobTime: register.histogram({
        name: "lodestar_block_processor_queue_job_time_seconds",
        help: "Time to process block processor queue job in seconds",
        buckets: [0.01, 0.1, 1, 10, 100],
      }),
      jobWaitTime: register.histogram({
        name: "lodestar_block_processor_queue_job_wait_time_seconds",
        help: "Time from job added to the block processor queue to starting in seconds",
        buckets: [0.01, 0.1, 1, 10, 100],
      }),
      concurrency: register.gauge({
        name: "lodestar_block_processor_queue_concurrency",
        help: "Current concurrency of block processor queue",
      }),
    },

    engineHttpProcessorQueue: {
      length: register.gauge({
        name: "lodestar_engine_http_processor_queue_length",
        help: "Count of total engine http processor queue length",
      }),
      droppedJobs: register.gauge({
        name: "lodestar_engine_http_processor_queue_dropped_jobs_total",
        help: "Count of total engine http processor queue dropped jobs",
      }),
      jobTime: register.histogram({
        name: "lodestar_engine_http_processor_queue_job_time_seconds",
        help: "Time to process engine http processor queue job in seconds",
        // newPayload can vary from 100 of ms to 3-4 seconds and typically 300-400ms
        buckets: [0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1, 2, 5, 10, 25],
      }),
      jobWaitTime: register.histogram({
        name: "lodestar_engine_http_processor_queue_job_wait_time_seconds",
        help: "Time from job added to the engine http processor queue to starting in seconds",
        // Ideally it should be picked up < 100 of ms and could run upto 100 of secs
        buckets: [0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1, 2, 5, 10, 25, 50, 100],
      }),
      concurrency: register.gauge({
        name: "lodestar_engine_http_processor_queue_concurrency_total",
        help: "Current concurrency of engine http processor queue",
      }),
    },

    apiRest: {
      responseTime: register.histogram<"operationId">({
        name: "lodestar_api_rest_response_time_seconds",
        help: "REST API time to fulfill a request by operationId",
        labelNames: ["operationId"],
        // Request times range between 1ms to 100ms in normal conditions. Can get to 1-5 seconds if overloaded
        buckets: [0.01, 0.1, 1],
      }),
      requests: register.gauge<"operationId">({
        name: "lodestar_api_rest_requests_total",
        help: "REST API total count requests by operationId",
        labelNames: ["operationId"],
      }),
      errors: register.gauge<"operationId">({
        name: "lodestar_api_rest_errors_total",
        help: "REST API total count of errors by operationId",
        labelNames: ["operationId"],
      }),
      // Metrics for HttpActiveSocketsTracker, defined there
      activeSockets: register.gauge({
        name: "lodestar_api_rest_active_sockets_count",
        help: "REST API current count of active sockets",
      }),
      socketsBytesRead: register.gauge({
        name: "lodestar_api_rest_sockets_bytes_read_total",
        help: "REST API total count of bytes read on all sockets",
      }),
      socketsBytesWritten: register.gauge({
        name: "lodestar_api_rest_sockets_bytes_written_total",
        help: "REST API total count of bytes written on all sockets",
      }),
    },

    // Beacon state transition metrics

    epochTransitionTime: register.histogram({
      name: "lodestar_stfn_epoch_transition_seconds",
      help: "Time to process a single epoch transition in seconds",
      // Epoch transitions are 100ms on very fast clients, and average 800ms on heavy networks
      buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 0.75, 1, 1.25, 1.5, 3, 10],
    }),
    epochTransitionCommitTime: register.histogram({
      name: "lodestar_stfn_epoch_transition_commit_seconds",
      help: "Time to call commit after process a single epoch transition in seconds",
      buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 0.75, 1],
    }),
    processBlockTime: register.histogram({
      name: "lodestar_stfn_process_block_seconds",
      help: "Time to process a single block in seconds",
      // TODO: Add metrics for each step
      // Block processing can take 5-40ms, 100ms max
      buckets: [0.005, 0.01, 0.02, 0.05, 0.1, 1],
    }),
    processBlockCommitTime: register.histogram({
      name: "lodestar_stfn_process_block_commit_seconds",
      help: "Time to call commit after process a single block in seconds",
      buckets: [0.005, 0.01, 0.02, 0.05, 0.1, 1],
    }),
    stateHashTreeRootTime: register.histogram({
      name: "lodestar_stfn_hash_tree_root_seconds",
      help: "Time to compute the hash tree root of a post state in seconds",
      buckets: [0.005, 0.01, 0.02, 0.05, 0.1, 1],
    }),
    preStateBalancesNodesPopulatedMiss: register.gauge<"source">({
      name: "lodestar_stfn_balances_nodes_populated_miss_total",
      help: "Total count state.balances nodesPopulated is false on stfn",
      labelNames: ["source"],
    }),
    preStateBalancesNodesPopulatedHit: register.gauge<"source">({
      name: "lodestar_stfn_balances_nodes_populated_hit_total",
      help: "Total count state.balances nodesPopulated is true on stfn",
      labelNames: ["source"],
    }),
    preStateValidatorsNodesPopulatedMiss: register.gauge<"source">({
      name: "lodestar_stfn_validators_nodes_populated_miss_total",
      help: "Total count state.validators nodesPopulated is false on stfn",
      labelNames: ["source"],
    }),
    preStateValidatorsNodesPopulatedHit: register.gauge<"source">({
      name: "lodestar_stfn_validators_nodes_populated_hit_total",
      help: "Total count state.validators nodesPopulated is true on stfn",
      labelNames: ["source"],
    }),
    preStateClonedCount: register.histogram({
      name: "lodestar_stfn_state_cloned_count",
      help: "Histogram of cloned count per state every time state.clone() is called",
      buckets: [1, 2, 5, 10, 50, 250],
    }),
    postStateBalancesNodesPopulatedHit: register.gauge({
      name: "lodestar_stfn_post_state_balances_nodes_populated_hit_total",
      help: "Total count state.validators nodesPopulated is true on stfn for post state",
    }),
    postStateBalancesNodesPopulatedMiss: register.gauge({
      name: "lodestar_stfn_post_state_balances_nodes_populated_miss_total",
      help: "Total count state.validators nodesPopulated is false on stfn for post state",
    }),
    postStateValidatorsNodesPopulatedHit: register.gauge({
      name: "lodestar_stfn_post_state_validators_nodes_populated_hit_total",
      help: "Total count state.validators nodesPopulated is true on stfn for post state",
    }),
    postStateValidatorsNodesPopulatedMiss: register.gauge({
      name: "lodestar_stfn_post_state_validators_nodes_populated_miss_total",
      help: "Total count state.validators nodesPopulated is false on stfn for post state",
    }),

    // BLS verifier thread pool and queue

    bls: {
      aggregatedPubkeys: register.gauge({
        name: "lodestar_bls_aggregated_pubkeys_total",
        help: "Total aggregated pubkeys for BLS validation",
      }),
    },

    blsThreadPool: {
      jobsWorkerTime: register.gauge<"workerId">({
        name: "lodestar_bls_thread_pool_time_seconds_sum",
        help: "Total time spent verifying signature sets measured on the worker",
        labelNames: ["workerId"],
      }),
      successJobsSignatureSetsCount: register.gauge({
        name: "lodestar_bls_thread_pool_success_jobs_signature_sets_count",
        help: "Count of total verified signature sets",
      }),
      errorJobsSignatureSetsCount: register.gauge({
        name: "lodestar_bls_thread_pool_error_jobs_signature_sets_count",
        help: "Count of total error-ed signature sets",
      }),
      jobWaitTime: register.histogram({
        name: "lodestar_bls_thread_pool_queue_job_wait_time_seconds",
        help: "Time from job added to the queue to starting the job in seconds",
        buckets: [0.01, 0.02, 0.5, 0.1, 0.3, 1],
      }),
      queueLength: register.gauge({
        name: "lodestar_bls_thread_pool_queue_length",
        help: "Count of total block processor queue length",
      }),
      totalJobsGroupsStarted: register.gauge({
        name: "lodestar_bls_thread_pool_job_groups_started_total",
        help: "Count of total jobs groups started in bls thread pool, job groups include +1 jobs",
      }),
      totalJobsStarted: register.gauge({
        name: "lodestar_bls_thread_pool_jobs_started_total",
        help: "Count of total jobs started in bls thread pool, jobs include +1 signature sets",
      }),
      totalSigSetsStarted: register.gauge({
        name: "lodestar_bls_thread_pool_sig_sets_started_total",
        help: "Count of total signature sets started in bls thread pool, sig sets include 1 pk, msg, sig",
      }),
      // Re-verifying a batch means doing double work. This number must be very low or it can be a waste of CPU resources
      batchRetries: register.gauge({
        name: "lodestar_bls_thread_pool_batch_retries_total",
        help: "Count of total batches that failed and had to be verified again.",
      }),
      // To count how many sigs are being validated with the optimization of batching them
      batchSigsSuccess: register.gauge({
        name: "lodestar_bls_thread_pool_batch_sigs_success_total",
        help: "Count of total batches that failed and had to be verified again.",
      }),
      // To measure the time cost of main thread <-> worker message passing
      latencyToWorker: register.histogram({
        name: "lodestar_bls_thread_pool_latency_to_worker",
        help: "Time from sending the job to the worker and the worker receiving it",
        buckets: [0.001, 0.003, 0.01, 0.03, 0.1],
      }),
      latencyFromWorker: register.histogram({
        name: "lodestar_bls_thread_pool_latency_from_worker",
        help: "Time from the worker sending the result and the main thread receiving it",
        buckets: [0.001, 0.003, 0.01, 0.03, 0.1],
      }),
      mainThreadDurationInThreadPool: register.histogram({
        name: "lodestar_bls_thread_pool_main_thread_time_seconds",
        help: "Time to verify signatures in main thread with thread pool mode",
        // Time can vary significantly, so just track usage ratio
        buckets: [0],
      }),
      timePerSigSet: register.histogram({
        name: "lodestar_bls_worker_thread_time_per_sigset_seconds",
        help: "Time to verify each sigset with worker thread mode",
        // Time per sig ~0.9ms on good machines
        buckets: [0.5e-3, 0.75e-3, 1e-3, 1.5e-3, 2e-3, 5e-3],
      }),
    },

    // BLS time on single thread mode
    blsSingleThread: {
      singleThreadDuration: register.histogram({
        name: "lodestar_bls_single_thread_time_seconds",
        help: "Time to verify signatures with single thread mode",
        buckets: [0],
      }),
      timePerSigSet: register.histogram({
        name: "lodestar_bls_single_thread_time_per_sigset_seconds",
        help: "Time to verify each sigset with single thread mode",
        // Time per sig ~0.9ms on good machines
        buckets: [0.5e-3, 0.75e-3, 1e-3, 1.5e-3, 2e-3, 5e-3],
      }),
    },

    // Sync

    syncStatus: register.gauge({
      name: "lodestar_sync_status",
      help: "Range sync status: [Stalled, SyncingFinalized, SyncingHead, Synced]",
    }),
    syncPeersBySyncType: register.gauge<"syncType">({
      name: "lodestar_sync_range_sync_peers",
      help: "Count of peers by sync type [FullySynced, Advanced, Behind]",
      labelNames: ["syncType"],
    }),
    syncSwitchGossipSubscriptions: register.gauge<"action">({
      name: "lodestar_sync_switch_gossip_subscriptions",
      help: "Sync switched gossip subscriptions on/off",
      labelNames: ["action"],
    }),

    syncRange: {
      syncChainsEvents: register.gauge<"syncType" | "event">({
        name: "lodestar_sync_chains_events_total",
        help: "Total number of sync chains events events, labeled by syncType",
        labelNames: ["syncType", "event"],
      }),
      syncChains: register.gauge<"syncType">({
        name: "lodestar_sync_chains_count",
        help: "Count of sync chains by syncType",
        labelNames: ["syncType"],
      }),
      syncChainsPeers: register.histogram<"syncType">({
        name: "lodestar_sync_chains_peer_count_by_type",
        help: "Count of sync chain peers by syncType",
        labelNames: ["syncType"],
        buckets: [0, 2, 5, 15, 50],
      }),
      syncChainHighestTargetSlotCompleted: register.gauge({
        name: "lodestar_sync_chain_highest_target_slot_completed",
        help: "Highest target slot completed by a sync chain",
      }),
    },

    syncUnknownBlock: {
      requests: register.gauge({
        name: "lodestar_sync_unknown_block_requests_total",
        help: "Total number of unknownBlockParent events or requests",
      }),
      pendingBlocks: register.gauge({
        name: "lodestar_sync_unknown_block_pending_blocks_size",
        help: "Current size of UnknownBlockSync pending blocks cache",
      }),
      knownBadBlocks: register.gauge({
        name: "lodestar_sync_unknown_block_known_bad_blocks_size",
        help: "Current size of UnknownBlockSync known bad blocks cache",
      }),
      processedBlocksSuccess: register.gauge({
        name: "lodestar_sync_unknown_block_processed_blocks_success_total",
        help: "Total number of processed blocks successes in UnknownBlockSync",
      }),
      processedBlocksError: register.gauge({
        name: "lodestar_sync_unknown_block_processed_blocks_error_total",
        help: "Total number of processed blocks errors in UnknownBlockSync",
      }),
      downloadedBlocksSuccess: register.gauge({
        name: "lodestar_sync_unknown_block_downloaded_blocks_success_total",
        help: "Total number of downloaded blocks successes in UnknownBlockSync",
      }),
      downloadedBlocksError: register.gauge({
        name: "lodestar_sync_unknown_block_downloaded_blocks_error_total",
        help: "Total number of downloaded blocks errors in UnknownBlockSync",
      }),
      removedBlocks: register.gauge({
        name: "lodestar_sync_unknown_block_removed_blocks_total",
        help: "Total number of removed bad blocks in UnknownBlockSync",
      }),
    },

    // Gossip block
    gossipBlock: {
      elapsedTimeTillReceived: register.histogram({
        name: "lodestar_gossip_block_elapsed_time_till_received",
        help: "Time elapsed between block slot time and the time block received via gossip",
        buckets: [0.5, 1, 2, 4, 6, 12],
      }),
      elapsedTimeTillProcessed: register.histogram({
        name: "lodestar_gossip_block_elapsed_time_till_processed",
        help: "Time elapsed between block slot time and the time block processed",
        buckets: [0.5, 1, 2, 4, 6, 12],
      }),
      receivedToGossipValidate: register.histogram({
        name: "lodestar_gossip_block_received_to_gossip_validate",
        help: "Time elapsed between block received and block validated",
        buckets: [0.05, 0.1, 0.2, 0.5, 1, 1.5, 2, 4],
      }),
      receivedToStateTransition: register.histogram({
        name: "lodestar_gossip_block_received_to_state_transition",
        help: "Time elapsed between block received and block state transition",
        buckets: [0.05, 0.1, 0.2, 0.5, 1, 1.5, 2, 4],
      }),
      receivedToSignaturesVerification: register.histogram({
        name: "lodestar_gossip_block_received_to_signatures_verification",
        help: "Time elapsed between block received and block signatures verification",
        buckets: [0.05, 0.1, 0.2, 0.5, 1, 1.5, 2, 4],
      }),
      receivedToExecutionPayloadVerification: register.histogram({
        name: "lodestar_gossip_block_received_to_execution_payload_verification",
        help: "Time elapsed between block received and execution payload verification",
        buckets: [0.05, 0.1, 0.2, 0.5, 1, 1.5, 2, 4],
      }),
      receivedToBlockImport: register.histogram({
        name: "lodestar_gossip_block_received_to_block_import",
        help: "Time elapsed between block received and block import",
        buckets: [0.05, 0.1, 0.2, 0.5, 1, 1.5, 2, 4],
      }),
    },
    elapsedTimeTillBecomeHead: register.histogram({
      name: "lodestar_gossip_block_elapsed_time_till_become_head",
      help: "Time elapsed between block slot time and the time block becomes head",
      buckets: [0.5, 1, 2, 4, 6, 12],
    }),
    engineNotifyNewPayloadResult: register.gauge<"result">({
      name: "lodestar_execution_engine_notify_new_payload_result_total",
      help: "The total result of calling notifyNewPayload execution engine api",
      labelNames: ["result"],
    }),
    backfillSync: {
      backfilledTillSlot: register.gauge({
        name: "lodestar_backfill_till_slot",
        help: "Current lowest backfilled slot",
      }),
      prevFinOrWsSlot: register.gauge({
        name: "lodestar_backfill_prev_fin_or_ws_slot",
        help: "Slot of previous finalized or wsCheckpoint block to be validated",
      }),
      totalBlocks: register.gauge<"method">({
        name: "lodestar_backfill_sync_blocks_total",
        help: "Total amount of backfilled blocks",
        labelNames: ["method"],
      }),
      errors: register.gauge({
        name: "lodestar_backfill_sync_errors_total",
        help: "Total number of errors while backfilling",
      }),
      status: register.gauge({
        name: "lodestar_backfill_sync_status",
        help: "Current backfill syncing status: [Aborted, Pending, Syncing, Completed]",
      }),
    },

    opPool: {
      // Note: Current opPool metrics only track current size.
      //       I don't believe tracking total add() count is relevant since that can be seen with gossip ACCEPTs
      aggregatedAttestationPoolSize: register.gauge({
        name: "lodestar_oppool_aggregated_attestation_pool_size",
        help: "Current size of the AggregatedAttestationPool = total attestations",
      }),
      /** This metric helps view how many overlapping attestations we keep per data on average */
      aggregatedAttestationPoolUniqueData: register.gauge({
        name: "lodestar_oppool_aggregated_attestation_pool_unique_data_count",
        help: "Current size of the AggregatedAttestationPool = total attestations unique by data",
      }),
      attestationPoolSize: register.gauge({
        name: "lodestar_oppool_attestation_pool_size",
        help: "Current size of the AttestationPool = total attestations unique by data and slot",
      }),
      attestationPoolInsertOutcome: register.counter<"insertOutcome">({
        name: "lodestar_attestation_pool_insert_outcome_total",
        help: "Total number of InsertOutcome as a result of adding an attestation in a pool",
        labelNames: ["insertOutcome"],
      }),
      attesterSlashingPoolSize: register.gauge({
        name: "lodestar_oppool_attester_slashing_pool_size",
        help: "Current size of the AttesterSlashingPool",
      }),
      proposerSlashingPoolSize: register.gauge({
        name: "lodestar_oppool_proposer_slashing_pool_size",
        help: "Current size of the ProposerSlashingPool",
      }),
      voluntaryExitPoolSize: register.gauge({
        name: "lodestar_oppool_voluntary_exit_pool_size",
        help: "Current size of the VoluntaryExitPool",
      }),
      blsToExecutionChangePoolSize: register.gauge({
        name: "lodestar_oppool_bls_to_execution_change_pool_size",
        help: "Current size of the blsToExecutionChangePool",
      }),
      syncCommitteeMessagePoolSize: register.gauge({
        name: "lodestar_oppool_sync_committee_message_pool_size",
        help: "Current size of the SyncCommitteeMessagePool unique by slot subnet and block root",
      }),
      syncContributionAndProofPoolSize: register.gauge({
        name: "lodestar_oppool_sync_contribution_and_proof_pool_pool_size",
        help: "Current size of the SyncContributionAndProofPool unique by slot subnet and block root",
      }),
    },

    // Validator monitoring

    validatorMonitor: {
      validatorsConnected: register.gauge({
        name: "validator_monitor_validators",
        help: "Count of validators that are specifically monitored by this beacon node",
      }),

      validatorsInSyncCommittee: register.gauge({
        name: "validator_monitor_validators_in_sync_committee",
        help: "Count of validators monitored by this beacon node that are part of sync committee",
      }),

      // Validator Monitor Metrics (per-epoch summaries)
      // Only track prevEpochOnChainBalance per index
      prevEpochOnChainBalance: register.gauge<"index">({
        name: "validator_monitor_prev_epoch_on_chain_balance",
        help: "Balance of validator after an epoch",
        labelNames: ["index"],
      }),
      prevEpochOnChainAttesterHit: register.gauge({
        name: "validator_monitor_prev_epoch_on_chain_attester_hit_total",
        help: "Incremented if validator's submitted attestation is included in some blocks",
      }),
      prevEpochOnChainAttesterMiss: register.gauge({
        name: "validator_monitor_prev_epoch_on_chain_attester_miss_total",
        help: "Incremented if validator's submitted attestation is not included in any blocks",
      }),
      prevEpochOnChainSourceAttesterHit: register.gauge({
        name: "validator_monitor_prev_epoch_on_chain_source_attester_hit_total",
        help: "Incremented if the validator is flagged as a previous epoch source attester during per epoch processing",
      }),
      prevEpochOnChainSourceAttesterMiss: register.gauge({
        name: "validator_monitor_prev_epoch_on_chain_source_attester_miss_total",
        help:
          "Incremented if the validator is not flagged as a previous epoch source attester during per epoch processing",
      }),
      prevEpochOnChainHeadAttesterHit: register.gauge({
        name: "validator_monitor_prev_epoch_on_chain_head_attester_hit_total",
        help: "Incremented if the validator is flagged as a previous epoch head attester during per epoch processing",
      }),
      prevEpochOnChainHeadAttesterMiss: register.gauge({
        name: "validator_monitor_prev_epoch_on_chain_head_attester_miss_total",
        help:
          "Incremented if the validator is not flagged as a previous epoch head attester during per epoch processing",
      }),
      prevOnChainAttesterCorrectHead: register.gauge({
        name: "validator_monitor_prev_epoch_on_chain_attester_correct_head_total",
        help: "Total count of times a validator votes correct head",
      }),
      prevOnChainAttesterIncorrectHead: register.gauge({
        name: "validator_monitor_prev_epoch_on_chain_attester_incorrect_head_total",
        help: "Total count of times a validator votes incorrect head",
      }),
      prevEpochOnChainTargetAttesterHit: register.gauge({
        name: "validator_monitor_prev_epoch_on_chain_target_attester_hit_total",
        help: "Incremented if the validator is flagged as a previous epoch target attester during per epoch processing",
      }),
      prevEpochOnChainTargetAttesterMiss: register.gauge({
        name: "validator_monitor_prev_epoch_on_chain_target_attester_miss_total",
        help:
          "Incremented if the validator is not flagged as a previous epoch target attester during per epoch processing",
      }),
      prevEpochOnChainInclusionDistance: register.histogram({
        name: "validator_monitor_prev_epoch_on_chain_inclusion_distance",
        help: "The attestation inclusion distance calculated during per epoch processing",
        // min inclusion distance is 1, usual values are 1,2,3 max is 32 (1 epoch)
        buckets: [1, 2, 3, 5, 10, 32],
      }),
      prevEpochAttestations: register.histogram({
        name: "validator_monitor_prev_epoch_attestations",
        help: "The number of unagg. attestations seen in the previous epoch",
        buckets: [0, 1, 2, 3],
      }),
      prevEpochAttestationsMinDelaySeconds: register.histogram({
        name: "validator_monitor_prev_epoch_attestations_min_delay_seconds",
        help: "The min delay between when the validator should send the attestation and when it was received",
        buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10],
      }),
      prevEpochAttestationAggregateInclusions: register.histogram({
        name: "validator_monitor_prev_epoch_attestation_aggregate_inclusions",
        help: "The count of times an attestation was seen inside an aggregate",
        buckets: [0, 1, 2, 3, 5, 10],
      }),
      prevEpochAttestationBlockInclusions: register.histogram({
        name: "validator_monitor_prev_epoch_attestation_block_inclusions",
        help: "The count of times an attestation was seen inside a block",
        buckets: [0, 1, 2, 3, 5],
      }),
      prevEpochAttestationBlockMinInclusionDistance: register.histogram({
        name: "validator_monitor_prev_epoch_attestation_block_min_inclusion_distance",
        help: "The minimum inclusion distance observed for the inclusion of an attestation in a block",
        buckets: [1, 2, 3, 5, 10, 32],
      }),
      prevEpochBeaconBlocks: register.histogram({
        name: "validator_monitor_prev_epoch_beacon_blocks",
        help: "The number of beacon_blocks seen in the previous epoch",
        buckets: [0, 1, 2, 3, 5, 10],
      }),
      prevEpochBeaconBlocksMinDelaySeconds: register.histogram({
        name: "validator_monitor_prev_epoch_beacon_blocks_min_delay_seconds",
        help: "The min delay between when the validator should send the block and when it was received",
        buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10],
      }),
      prevEpochAggregatesTotal: register.histogram({
        name: "validator_monitor_prev_epoch_aggregates",
        help: "The number of aggregates seen in the previous epoch",
        buckets: [0, 1, 2, 3, 5, 10],
      }),
      prevEpochAggregatesMinDelaySeconds: register.histogram({
        name: "validator_monitor_prev_epoch_aggregates_min_delay_seconds",
        help: "The min delay between when the validator should send the aggregate and when it was received",
        buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10],
      }),
      prevEpochSyncCommitteeHits: register.gauge({
        name: "validator_monitor_prev_epoch_sync_committee_hits",
        help: "Count of times in prev epoch connected validators participated in imported block's syncAggregate",
      }),
      prevEpochSyncCommitteeMisses: register.gauge({
        name: "validator_monitor_prev_epoch_sync_committee_misses",
        help: "Count of times in prev epoch connected validators fail to participate in imported block's syncAggregate",
      }),
      prevEpochSyncSignatureAggregateInclusions: register.histogram({
        name: "validator_monitor_prev_epoch_sync_signature_aggregate_inclusions",
        help: "The count of times a sync signature was seen inside an aggregate",
        buckets: [0, 1, 2, 3, 5, 10],
      }),

      // Validator Monitor Metrics (real-time)

      unaggregatedAttestationTotal: register.gauge<"src">({
        name: "validator_monitor_unaggregated_attestation_total",
        help: "Number of unaggregated attestations seen",
        labelNames: ["src"],
      }),
      unaggregatedAttestationDelaySeconds: register.histogram<"src">({
        name: "validator_monitor_unaggregated_attestation_delay_seconds",
        help: "The delay between when the validator should send the attestation and when it was received",
        labelNames: ["src"],
        buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10],
      }),
      unaggregatedAttestationSubmittedSentPeers: register.histogram({
        name: "validator_monitor_unaggregated_attestation_submitted_sent_peers_count",
        help: "Number of peers that an unaggregated attestation sent to",
        // as of Apr 2022, most of the time we sent to >30 peers per attestations
        // these bucket values just base on that fact to get equal range
        // refine if we want more reasonable values
        buckets: [0, 10, 20, 30],
      }),
      aggregatedAttestationTotal: register.gauge<"src">({
        name: "validator_monitor_aggregated_attestation_total",
        help: "Number of aggregated attestations seen",
        labelNames: ["src"],
      }),
      aggregatedAttestationDelaySeconds: register.histogram<"src">({
        name: "validator_monitor_aggregated_attestation_delay_seconds",
        help: "The delay between then the validator should send the aggregate and when it was received",
        labelNames: ["src"],
        buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10],
      }),
      attestationInAggregateTotal: register.gauge<"src">({
        name: "validator_monitor_attestation_in_aggregate_total",
        help: "Number of times an attestation has been seen in an aggregate",
        labelNames: ["src"],
      }),
      attestationInAggregateDelaySeconds: register.histogram<"src">({
        name: "validator_monitor_attestation_in_aggregate_delay_seconds",
        help: "The delay between when the validator should send the aggregate and when it was received",
        labelNames: ["src"],
        buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10],
      }),
      attestationInBlockTotal: register.gauge({
        name: "validator_monitor_attestation_in_block_total",
        help: "Number of times an attestation has been seen in a block",
      }),
      attestationInBlockDelaySlots: register.histogram({
        name: "validator_monitor_attestation_in_block_delay_slots",
        help: "The excess slots (beyond the minimum delay) between the attestation slot and the block slot",
        buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10],
      }),
      syncSignatureInAggregateTotal: register.gauge({
        name: "validator_monitor_sync_signature_in_aggregate_total",
        help: "Number of times a sync signature has been seen in an aggregate",
      }),
      beaconBlockTotal: register.gauge<"src">({
        name: "validator_monitor_beacon_block_total",
        help: "Total number of beacon blocks seen",
        labelNames: ["src"],
      }),
      beaconBlockDelaySeconds: register.histogram<"src">({
        name: "validator_monitor_beacon_block_delay_seconds",
        help: "The delay between when the validator should send the block and when it was received",
        labelNames: ["src"],
        // we also want other nodes to received our published before 4s so add bucket 3 and 3.5
        buckets: [0.1, 0.25, 0.5, 1, 2, 3, 4, 6, 10],
      }),

      // Only for known
      proposerBalanceDeltaKnown: register.histogram({
        name: "validator_monitor_proposer_balance_delta_known_gwei",
        help: "Balance delta of known block proposer after importing a valid block",
        // Jul22 mainnet block reward is consistently between 29,000,000-28,000,000 GWei
        buckets: [10_000, 100_000, 1e6, 10e6, 20e6, 50e6, 100e6, 1000e6],
      }),
    },

    proposerBalanceDeltaAny: register.histogram({
      name: "lodestar_proposer_balance_delta_any_gwei",
      help: "Balance delta of every block proposer after importing a valid block",
      buckets: [10_000, 100_000, 1e6, 10e6, 20e6, 50e6, 100e6, 1000e6],
    }),

    // regen metrics

    stateCache: {
      lookups: register.gauge({
        name: "lodestar_state_cache_lookups_total",
        help: "Total number of cache lookup",
      }),
      hits: register.gauge({
        name: "lodestar_state_cache_hits_total",
        help: "Total number of cache hits",
      }),
      adds: register.gauge({
        name: "lodestar_state_cache_adds_total",
        help: "Total number of items added in state cache",
      }),
      size: register.gauge({
        name: "lodestar_state_cache_size",
        help: "State cache size",
      }),
      reads: register.avgMinMax({
        name: "lodestar_state_cache_reads",
        help: "Avg min max of all state cache items total read count",
      }),
      secondsSinceLastRead: register.avgMinMax({
        name: "lodestar_state_cache_seconds_since_last_read",
        help: "Avg min max of all state cache items seconds since last reads",
      }),
      stateClonedCount: register.histogram({
        name: "lodestar_state_cache_state_cloned_count",
        help: "Histogram of cloned count per state every time state.clone() is called",
        buckets: [1, 2, 5, 10, 50, 250],
      }),
    },

    cpStateCache: {
      lookups: register.gauge({
        name: "lodestar_cp_state_cache_lookups_total",
        help: "Total number of checkpoint cache lookup",
      }),
      hits: register.gauge({
        name: "lodestar_cp_state_cache_hits_total",
        help: "Total number of checkpoint cache hits",
      }),
      adds: register.gauge({
        name: "lodestar_cp_state_cache_adds_total",
        help: "Total number of items added in checkpoint state cache",
      }),
      size: register.gauge({
        name: "lodestar_cp_state_cache_size",
        help: "Checkpoint state cache size",
      }),
      epochSize: register.gauge({
        name: "lodestar_cp_state_epoch_size",
        help: "Checkpoint state cache size",
      }),
      reads: register.avgMinMax({
        name: "lodestar_cp_state_epoch_reads",
        help: "Avg min max of all state cache items total read count",
      }),
      secondsSinceLastRead: register.avgMinMax({
        name: "lodestar_cp_state_epoch_seconds_since_last_read",
        help: "Avg min max of all state cache items seconds since last reads",
      }),
      stateClonedCount: register.histogram({
        name: "lodestar_cp_state_cache_state_cloned_count",
        help: "Histogram of cloned count per state every time state.clone() is called",
        buckets: [1, 2, 5, 10, 50, 250],
      }),
    },

    balancesCache: {
      requests: register.counter({
        name: "lodestar_balances_cache_requests_total",
        help: "Total number of balances cache requests",
      }),
      misses: register.counter({
        name: "lodestar_balances_cache_misses_total",
        help: "Total number of balances cache misses",
      }),
      closestStateResult: register.counter<"stateId">({
        name: "lodestar_balances_cache_closest_state_result_total",
        help: "Total number of stateIds returned as closest justified balances state by id",
        labelNames: ["stateId"],
      }),
    },

    seenCache: {
      aggregatedAttestations: {
        superSetCheckTotal: register.histogram({
          name: "lodestar_seen_cache_aggregated_attestations_super_set_check_total",
          help: "Number of times to call isNonStrictSuperSet in SeenAggregatedAttestations",
          buckets: [1, 4, 10],
        }),
        isKnownCalls: register.gauge({
          name: "lodestar_seen_cache_aggregated_attestations_is_known_call_total",
          help: "Total times calling SeenAggregatedAttestations.isKnown",
        }),
        isKnownHits: register.gauge({
          name: "lodestar_seen_cache_aggregated_attestations_is_known_hit_total",
          help: "Total times SeenAggregatedAttestations.isKnown returning true",
        }),
      },
      committeeContributions: {
        superSetCheckTotal: register.histogram({
          name: "lodestar_seen_cache_committee_contributions_super_set_check_total",
          help: "Number of times to call isNonStrictSuperSet in SeenContributionAndProof",
          buckets: [1, 4, 10],
        }),
        isKnownCalls: register.gauge({
          name: "lodestar_seen_cache_committee_contributions_is_known_call_total",
          help: "Total times calling SeenContributionAndProof.isKnown",
        }),
        isKnownHits: register.gauge({
          name: "lodestar_seen_cache_committee_contributions_is_known_hit_total",
          help: "Total times SeenContributionAndProof.isKnown returning true",
        }),
      },
    },

    regenFnCallTotal: register.gauge<"entrypoint" | "caller">({
      name: "lodestar_regen_fn_call_total",
      help: "Total number of calls for regen functions",
      labelNames: ["entrypoint", "caller"],
    }),
    regenFnQueuedTotal: register.gauge<"entrypoint" | "caller">({
      name: "lodestar_regen_fn_queued_total",
      help: "Total number of calls queued for regen functions",
      labelNames: ["entrypoint", "caller"],
    }),
    regenFnCallDuration: register.histogram<"entrypoint" | "caller">({
      name: "lodestar_regen_fn_call_duration",
      help: "regen function duration",
      labelNames: ["entrypoint", "caller"],
      buckets: [0.1, 1, 10, 100],
    }),
    regenFnTotalErrors: register.gauge<"entrypoint" | "caller">({
      name: "lodestar_regen_fn_errors_total",
      help: "regen function total errors",
      labelNames: ["entrypoint", "caller"],
    }),
    unhandledPromiseRejections: register.gauge({
      name: "lodestar_unhandled_promise_rejections_total",
      help: "UnhandledPromiseRejection total count",
    }),

    // Precompute next epoch transition
    precomputeNextEpochTransition: {
      count: register.counter<"result">({
        name: "lodestar_precompute_next_epoch_transition_result_total",
        labelNames: ["result"],
        help: "Total number of precomputeNextEpochTransition runs by result",
      }),
      hits: register.gauge({
        name: "lodestar_precompute_next_epoch_transition_hits_total",
        help: "Total number of calls uses precomputed checkpoint state cache",
      }),
      waste: register.counter({
        name: "lodestar_precompute_next_epoch_transition_waste_total",
        help: "Total number of precomputing next epoch transition wasted",
      }),
    },

    // reprocess attestations
    reprocessAttestations: {
      total: register.gauge({
        name: "lodestar_reprocess_attestations_total",
        help: "Total number of attestations waiting to reprocess",
      }),
      resolve: register.gauge({
        name: "lodestar_reprocess_attestations_resolve_total",
        help: "Total number of attestations are reprocessed",
      }),
      waitTimeBeforeResolve: register.gauge({
        name: "lodestar_reprocess_attestations_wait_time_resolve_seconds",
        help: "Time to wait for unknown block in seconds",
      }),
      reject: register.gauge<"reason">({
        name: "lodestar_reprocess_attestations_reject_total",
        help: "Total number of attestations are rejected to reprocess",
        labelNames: ["reason"],
      }),
      waitTimeBeforeReject: register.gauge<"reason">({
        name: "lodestar_reprocess_attestations_wait_time_reject_seconds",
        help: "Time to wait for unknown block before being rejected",
      }),
    },

    lightclientServer: {
      onSyncAggregate: register.gauge<"event">({
        name: "lodestar_lightclient_server_on_sync_aggregate_event_total",
        help: "Total number of relevant events onSyncAggregate fn",
        labelNames: ["event"],
      }),
      highestSlot: register.gauge<"item">({
        name: "lodestar_lightclient_server_highest_slot",
        help: "Current highest slot of items stored by LightclientServer",
        labelNames: ["item"],
      }),
      updateNotBetter: register.gauge({
        name: "lodestar_lightclient_server_event_update_not_better_total",
        help: "Total number of cache hits in LightclientServer.prevHeadData",
      }),
      attestedDataCacheMiss: register.gauge({
        name: "lodestar_lightclient_server_attested_cache_miss_total",
        help: "Total number of cache miss in LightclientServer.prevHeadData",
      }),
      attestedDataDiffPeriod: register.gauge({
        name: "lodestar_lightclient_server_attested_data_diff_period_total",
        help: "Total number of times a syncAggregate is a different period than attested data",
      }),
    },

    eth1: {
      depositTrackerIsCaughtup: register.gauge({
        name: "lodestar_eth1_deposit_tracker_is_caughtup",
        help: "Eth1 deposit is caught up 0=false 1=true",
      }),
      depositTrackerUpdateErrors: register.gauge({
        name: "lodestar_eth1_deposit_tracker_update_errors_total",
        help: "Eth1 deposit update loop errors total",
      }),
      remoteHighestBlock: register.gauge({
        name: "lodestar_eth1_remote_highest_block",
        help: "Eth1 current highest block number",
      }),
      depositEventsFetched: register.gauge({
        name: "lodestar_eth1_deposit_events_fetched_total",
        help: "Eth1 deposit events fetched total",
      }),
      lastProcessedDepositBlockNumber: register.gauge({
        name: "lodestar_eth1_last_processed_deposit_block_number",
        help: "Eth1 deposit tracker lastProcessedDepositBlockNumber",
      }),
      blocksFetched: register.gauge({
        name: "lodestar_eth1_blocks_fetched_total",
        help: "Eth1 blocks fetched total",
      }),
      lastFetchedBlockBlockNumber: register.gauge({
        name: "lodestar_eth1_last_fetched_block_block_number",
        help: "Eth1 deposit tracker last fetched block's block number",
      }),
      lastFetchedBlockTimestamp: register.gauge({
        name: "lodestar_eth1_last_fetched_block_timestamp",
        help: "Eth1 deposit tracker last fetched block's timestamp",
      }),
      eth1FollowDistanceSecondsConfig: register.gauge({
        name: "lodestar_eth1_follow_distance_seconds_config",
        help: "Constant with value = SECONDS_PER_ETH1_BLOCK * ETH1_FOLLOW_DISTANCE",
      }),
      eth1FollowDistanceDynamic: register.gauge({
        name: "lodestar_eth1_follow_distance_dynamic",
        help: "Eth1 dynamic follow distance changed by the deposit tracker if blocks are slow",
      }),
      eth1GetBlocksBatchSizeDynamic: register.gauge({
        name: "lodestar_eth1_blocks_batch_size_dynamic",
        help: "Dynamic batch size to fetch blocks",
      }),
      eth1GetLogsBatchSizeDynamic: register.gauge({
        name: "lodestar_eth1_logs_batch_size_dynamic",
        help: "Dynamic batch size to fetch deposit logs",
      }),

      // Merge Search info
      eth1MergeStatus: register.gauge({
        name: "lodestar_eth1_merge_status",
        help: "Eth1 Merge Status 0 PRE_MERGE 1 SEARCHING 2 FOUND 3 POST_MERGE",
      }),
      eth1MergeTDFactor: register.gauge({
        name: "lodestar_eth1_merge_td_factor",
        help: "TTD set for the merge",
      }),
      eth1MergeTTD: register.gauge({
        name: "lodestar_eth1_merge_ttd",
        help: "TTD set for the merge scaled down by td_factor",
      }),

      eth1PollMergeBlockErrors: register.gauge({
        name: "lodestar_eth1_poll_merge_block_errors_total",
        help: "Total count of errors polling merge block",
      }),
      getTerminalPowBlockPromiseCacheHit: register.gauge({
        name: "lodestar_eth1_get_terminal_pow_block_promise_cache_hit_total",
        help: "Total count of skipped runs in poll merge block, because a previous promise existed",
      }),
      eth1ParentBlocksFetched: register.gauge({
        name: "lodestar_eth1_parent_blocks_fetched_total",
        help: "Total count of parent blocks fetched searching for merge block",
      }),

      // Latest block details
      eth1LatestBlockTD: register.gauge({
        name: "lodestar_eth1_latest_block_ttd",
        help: "Eth1 latest Block td scaled down by td_factor",
      }),
      eth1LatestBlockNumber: register.gauge({
        name: "lodestar_eth1_latest_block_number",
        help: "Eth1 latest block number",
      }),
      eth1LatestBlockTimestamp: register.gauge({
        name: "lodestar_eth1_latest_block_timestamp",
        help: "Eth1 latest block timestamp",
      }),

      // Merge details
      eth1MergeBlockDetails: register.gauge<"terminalBlockHash" | "terminalBlockNumber" | "terminalBlockTD">({
        name: "lodestar_eth1_merge_block_details",
        help: "If found then 1 with terminal block details",
        labelNames: ["terminalBlockHash", "terminalBlockNumber", "terminalBlockTD"],
      }),
    },

    eth1HttpClient: {
      requestTime: register.histogram<"routeId">({
        name: "lodestar_eth1_http_client_request_time_seconds",
        help: "eth1 JsonHttpClient - histogram or roundtrip request times",
        labelNames: ["routeId"],
        // Provide max resolution on problematic values around 1 second
        buckets: [0.1, 0.5, 1, 2, 5, 15],
      }),
      streamTime: register.histogram<"routeId">({
        name: "lodestar_eth1_http_client_stream_time_seconds",
        help: "eth1 JsonHttpClient - streaming time by routeId",
        labelNames: ["routeId"],
        // Provide max resolution on problematic values around 1 second
        buckets: [0.1, 0.5, 1, 2, 5, 15],
      }),
      requestErrors: register.gauge<"routeId">({
        name: "lodestar_eth1_http_client_request_errors_total",
        help: "eth1 JsonHttpClient - total count of request errors",
        labelNames: ["routeId"],
      }),
      retryCount: register.gauge<"routeId">({
        name: "lodestar_eth1_http_client_request_retries_total",
        help: "eth1 JsonHttpClient - total count of request retries",
        labelNames: ["routeId"],
      }),
      requestUsedFallbackUrl: register.gauge({
        name: "lodestar_eth1_http_client_request_used_fallback_url_total",
        help: "eth1 JsonHttpClient - total count of requests on fallback url(s)",
        labelNames: ["routeId"],
      }),
      activeRequests: register.gauge({
        name: "lodestar_eth1_http_client_active_requests",
        help: "eth1 JsonHttpClient - current count of active requests",
        labelNames: ["routeId"],
      }),
      configUrlsCount: register.gauge({
        name: "lodestar_eth1_http_client_config_urls_count",
        help: "eth1 JsonHttpClient - static config urls count",
      }),
    },

    executionEnginerHttpClient: {
      requestTime: register.histogram<"routeId">({
        name: "lodestar_execution_engine_http_client_request_time_seconds",
        help: "ExecutionEngineHttp client - histogram or roundtrip request times",
        labelNames: ["routeId"],
        // Provide max resolution on problematic values around 1 second
        buckets: [0.1, 0.5, 1, 2, 5, 15],
      }),
      streamTime: register.histogram<"routeId">({
        name: "lodestar_execution_engine_http_client_stream_time_seconds",
        help: "ExecutionEngineHttp client - streaming time by routeId",
        labelNames: ["routeId"],
        // Provide max resolution on problematic values around 1 second
        buckets: [0.1, 0.5, 1, 2, 5, 15],
      }),
      requestErrors: register.gauge<"routeId">({
        name: "lodestar_execution_engine_http_client_request_errors_total",
        help: "ExecutionEngineHttp client - total count of request errors",
        labelNames: ["routeId"],
      }),
      retryCount: register.gauge<"routeId">({
        name: "lodestar_execution_engine_http_client_request_retries_total",
        help: "ExecutionEngineHttp client - total count of request retries",
        labelNames: ["routeId"],
      }),
      requestUsedFallbackUrl: register.gauge({
        name: "lodestar_execution_engine_http_client_request_used_fallback_url_total",
        help: "ExecutionEngineHttp client - total count of requests on fallback url(s)",
        labelNames: ["routeId"],
      }),
      activeRequests: register.gauge({
        name: "lodestar_execution_engine_http_client_active_requests",
        help: "ExecutionEngineHttp client - current count of active requests",
        labelNames: ["routeId"],
      }),
      configUrlsCount: register.gauge({
        name: "lodestar_execution_engine_http_client_config_urls_count",
        help: "ExecutionEngineHttp client - static config urls count",
      }),
    },

    builderHttpClient: {
      requestTime: register.histogram<"routeId">({
        name: "lodestar_builder_http_client_request_time_seconds",
        help: "Histogram of builder http client request time by routeId",
        labelNames: ["routeId"],
        // Expected times are ~ 50-500ms, but in an overload NodeJS they can be greater
        buckets: [0.01, 0.1, 1, 5],
      }),
      streamTime: register.histogram<"routeId">({
        name: "lodestar_builder_http_client_stream_time_seconds",
        help: "Builder api - streaming time by routeId",
        labelNames: ["routeId"],
        // Provide max resolution on problematic values around 1 second
        buckets: [0.1, 0.5, 1, 2, 5, 15],
      }),
      requestErrors: register.gauge<"routeId">({
        name: "lodestar_builder_http_client_request_errors_total",
        help: "Total count of errors on builder http client requests by routeId",
        labelNames: ["routeId"],
      }),
      requestToFallbacks: register.gauge<"routeId">({
        name: "lodestar_builder_http_client_request_to_fallbacks_total",
        help: "Total count of requests to fallback URLs on builder http API by routeId",
        labelNames: ["routeId"],
      }),

      urlsScore: register.gauge<"urlIndex">({
        name: "lodestar_builder_http_client_urls_score",
        help: "Current score of builder http URLs by url index",
        labelNames: ["urlIndex"],
      }),
    },

    db: {
      dbReadReq: register.gauge<"bucket">({
        name: "lodestar_db_read_req_total",
        help: "Total count of db read requests, may read 0 or more items",
        labelNames: ["bucket"],
      }),
      dbReadItems: register.gauge<"bucket">({
        name: "lodestar_db_read_items_total",
        help: "Total count of db read items, item = key | value | entry",
        labelNames: ["bucket"],
      }),
      dbWriteReq: register.gauge<"bucket">({
        name: "lodestar_db_write_req_total",
        help: "Total count of db write requests, may write 0 or more items",
        labelNames: ["bucket"],
      }),
      dbWriteItems: register.gauge<"bucket">({
        name: "lodestar_db_write_items_total",
        help: "Total count of db write items",
        labelNames: ["bucket"],
      }),
      dbSizeTotal: register.gauge({
        name: "lodestar_db_size_bytes_total",
        help: "Approximate number of bytes of file system space used by db",
      }),
      dbApproximateSizeTime: register.histogram({
        name: "lodestar_db_approximate_size_time_seconds",
        help: "Time to approximate db size in seconds",
        buckets: [0.0001, 0.001, 0.01, 0.1, 1],
      }),
    },
  };
}
