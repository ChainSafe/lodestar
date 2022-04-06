import {allForks} from "@chainsafe/lodestar-types";
import {RegistryMetricCreator} from "../utils/registryMetricCreator";
import {IMetricsOptions} from "../options";

export type ILodestarMetrics = ReturnType<typeof createLodestarMetrics>;

/**
 * Extra Lodestar custom metrics
 */
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/explicit-function-return-type
export function createLodestarMetrics(
  register: RegistryMetricCreator,
  metadata: IMetricsOptions["metadata"],
  anchorState?: Pick<allForks.BeaconState, "genesisTime">
) {
  if (metadata) {
    register.static<"semver" | "branch" | "commit" | "version" | "network">({
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
    clockSlot: register.gauge({
      name: "lodestar_clock_slot",
      help: "Current clock slot",
    }),

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
    peerLongLivedSubnets: register.avgMinMax({
      name: "lodestar_peer_long_lived_subnets_avg_min_max",
      help: "Avg min max of amount of long lived subnets of peers",
    }),
    peerScore: register.avgMinMax({
      name: "lodestar_peer_score_avg_min_max",
      help: "Avg min max of peer score at lodestar side",
    }),
    peerConnectionLength: register.avgMinMax({
      name: "lodestar_peer_connection_seconds_avg_min_max",
      help: "Avg min max of peer connection length in second",
    }),
    peersSync: register.gauge({
      name: "lodestar_peers_sync_count",
      help: "Current count of peers useful for sync",
    }),
    peerConnectedEvent: register.gauge<"direction">({
      name: "lodestar_peer_connected_total",
      help: "Total number of peer:connected event, labeled by direction",
      labelNames: ["direction"],
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
      help: "Priorization results total peers count requested to connect",
    }),
    peersRequestedToDisconnect: register.gauge({
      name: "lodestar_peers_requested_total_to_disconnect",
      help: "Priorization results total peers count requested to disconnect",
    }),
    peersRequestedSubnetsToQuery: register.gauge<"type">({
      name: "lodestar_peers_requested_total_subnets_to_query",
      help: "Priorization results total subnets to query and discover peers in",
      labelNames: ["type"],
    }),
    peersRequestedSubnetsPeerCount: register.gauge<"type">({
      name: "lodestar_peers_requested_total_subnets_peers_count",
      help: "Priorization results total peers in subnets to query and discover peers in",
      labelNames: ["type"],
    }),
    peersReportPeerCount: register.gauge<"reason">({
      name: "lodestar_peers_report_peer_count",
      help: "network.reportPeer count by reason",
      labelNames: ["reason"],
    }),

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

    discv5: {
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
    },

    gossipPeer: {
      scoreByThreshold: register.gauge<"threshold">({
        name: "lodestar_gossip_peer_score_by_threshold_count",
        help: "Gossip peer score by threashold",
        labelNames: ["threshold"],
      }),
      meshPeersByClient: register.gauge<"client">({
        name: "lodestar_gossip_mesh_peers_by_client_count",
        help: "number of mesh peers, labeled by client",
        labelNames: ["client"],
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
    }),
    gossipValidationQueueJobWaitTime: register.histogram<"topic">({
      name: "lodestar_gossip_validation_queue_job_wait_time_seconds",
      help: "Time from job added to the queue to starting the job in seconds",
      labelNames: ["topic"],
      buckets: [0.1, 1, 10, 100],
    }),

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
        buckets: [0.1, 1, 10, 100],
      }),
      jobWaitTime: register.histogram({
        name: "lodestar_regen_queue_job_wait_time_seconds",
        help: "Time from job added to the regen queue to starting in seconds",
        buckets: [0.1, 1, 10, 100],
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
      }),
      jobWaitTime: register.histogram({
        name: "lodestar_block_processor_queue_job_wait_time_seconds",
        help: "Time from job added to the block processor queue to starting in seconds",
        buckets: [0.1, 1, 10, 100],
      }),
    },

    apiRestResponseTime: register.histogram<"operationId">({
      name: "lodestar_api_rest_response_time_seconds",
      help: "Time to fullfill a request to the REST api labeled by operationId",
      labelNames: ["operationId"],
      // Request times range between 1ms to 100ms in normal conditions. Can get to 1-5 seconds if overloaded
      buckets: [0.01, 0.1, 1],
    }),

    // Beacon state transition metrics

    stfnEpochTransition: register.histogram({
      name: "lodestar_stfn_epoch_transition_seconds",
      help: "Time to process a single epoch transition in seconds",
      buckets: [0.1, 1, 10],
    }),
    stfnProcessBlock: register.histogram({
      name: "lodestar_stfn_process_block_seconds",
      help: "Time to process a single block in seconds",
      buckets: [0.1, 1, 10],
    }),

    // BLS verifier thread pool and queue

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
        buckets: [0.1, 1, 10],
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
        buckets: [0.1],
      }),
      latencyFromWorker: register.histogram({
        name: "lodestar_bls_thread_pool_latency_from_worker",
        help: "Time from the worker sending the result and the main thread receiving it",
        buckets: [0.1],
      }),
      mainThreadDurationInThreadPool: register.histogram({
        name: "lodestar_bls_thread_pool_main_thread_time_seconds",
        help: "Time to verify signatures in main thread with thread pool mode",
        buckets: [0.1, 1],
      }),
    },

    // BLS time on single thread mode
    blsSingleThread: {
      singleThreadDuration: register.histogram({
        name: "lodestar_bls_single_thread_time_seconds",
        help: "Time to verify signatures with single thread mode",
        buckets: [0.1, 1],
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
      syncChainsPeers: register.avgMinMax<"syncType">({
        name: "lodestar_sync_chains_peer_count_by_type",
        help: "Count of sync chain peers by syncType",
        labelNames: ["syncType"],
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
      elappsedTimeTillReceived: register.histogram({
        name: "lodestar_gossip_block_elappsed_time_till_received",
        help: "Time elappsed between block slot time and the time block received via gossip",
        buckets: [0.1, 1, 10],
      }),
      elappsedTimeTillProcessed: register.histogram({
        name: "lodestar_gossip_block_elappsed_time_till_processed",
        help: "Time elappsed between block slot time and the time block processed",
        buckets: [0.1, 1, 10],
      }),
    },

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

    // Validator monitoring

    validatorMonitor: {
      validatorsTotal: register.gauge({
        name: "validator_monitor_validators_total",
        help: "Count of validators that are specifically monitored by this beacon node",
        labelNames: ["index"],
      }),

      // Validator Monitor Metrics (per-epoch summaries)
      prevEpochOnChainBalance: register.gauge<"index">({
        name: "validator_monitor_prev_epoch_on_chain_balance_total",
        help: "Balance of validator after an epoch",
        labelNames: ["index"],
      }),
      prevEpochOnChainAttesterHit: register.gauge<"index">({
        name: "validator_monitor_prev_epoch_on_chain_attester_hit_total",
        help: "Incremented if the validator is flagged as a previous epoch attester during per epoch processing",
        labelNames: ["index"],
      }),
      prevEpochOnChainAttesterMiss: register.gauge<"index">({
        name: "validator_monitor_prev_epoch_on_chain_attester_miss_total",
        help: "Incremented if the validator is not flagged as a previous epoch attester during per epoch processing",
        labelNames: ["index"],
      }),
      prevEpochOnChainHeadAttesterHit: register.gauge<"index">({
        name: "validator_monitor_prev_epoch_on_chain_head_attester_hit_total",
        help: "Incremented if the validator is flagged as a previous epoch head attester during per epoch processing",
        labelNames: ["index"],
      }),
      prevEpochOnChainHeadAttesterMiss: register.gauge<"index">({
        name: "validator_monitor_prev_epoch_on_chain_head_attester_miss_total",
        help:
          "Incremented if the validator is not flagged as a previous epoch head attester during per epoch processing",
        labelNames: ["index"],
      }),
      prevOnChainAttesterCorrectHead: register.gauge<"index">({
        name: "validator_monitor_prev_epoch_on_chain_attester_correct_head_total",
        help: "Incremented if the validator votes correct head",
        labelNames: ["index"],
      }),
      prevEpochOnChainTargetAttesterHit: register.gauge<"index">({
        name: "validator_monitor_prev_epoch_on_chain_target_attester_hit_total",
        help: "Incremented if the validator is flagged as a previous epoch target attester during per epoch processing",
        labelNames: ["index"],
      }),
      prevEpochOnChainTargetAttesterMiss: register.gauge<"index">({
        name: "validator_monitor_prev_epoch_on_chain_target_attester_miss_total",
        help:
          "Incremented if the validator is not flagged as a previous epoch target attester during per epoch processing",
        labelNames: ["index"],
      }),
      prevEpochOnChainInclusionDistance: register.gauge<"index">({
        name: "validator_monitor_prev_epoch_on_chain_inclusion_distance",
        help: "The attestation inclusion distance calculated during per epoch processing",
        labelNames: ["index"],
      }),
      prevEpochAttestationsTotal: register.gauge<"index">({
        name: "validator_monitor_prev_epoch_attestations_total",
        help: "The number of unagg. attestations seen in the previous epoch",
        labelNames: ["index"],
      }),
      prevEpochAttestationsMinDelaySeconds: register.histogram<"index">({
        name: "validator_monitor_prev_epoch_attestations_min_delay_seconds",
        help: "The min delay between when the validator should send the attestation and when it was received",
        labelNames: ["index"],
        buckets: [0.1, 1],
      }),
      prevEpochAttestationAggregateInclusions: register.gauge<"index">({
        name: "validator_monitor_prev_epoch_attestation_aggregate_inclusions_total",
        help: "The count of times an attestation was seen inside an aggregate",
        labelNames: ["index"],
      }),
      prevEpochAttestationBlockInclusions: register.gauge<"index">({
        name: "validator_monitor_prev_epoch_attestation_block_inclusions_total",
        help: "The count of times an attestation was seen inside a block",
        labelNames: ["index"],
      }),
      prevEpochAttestationBlockMinInclusionDistance: register.gauge<"index">({
        name: "validator_monitor_prev_epoch_attestation_block_min_inclusion_distance",
        help: "The minimum inclusion distance observed for the inclusion of an attestation in a block",
        labelNames: ["index"],
      }),
      prevEpochBeaconBlocksTotal: register.gauge<"index">({
        name: "validator_monitor_prev_epoch_beacon_blocks_total",
        help: "The number of beacon_blocks seen in the previous epoch",
        labelNames: ["index"],
      }),
      prevEpochBeaconBlocksMinDelaySeconds: register.histogram<"index">({
        name: "validator_monitor_prev_epoch_beacon_blocks_min_delay_seconds",
        help: "The min delay between when the validator should send the block and when it was received",
        labelNames: ["index"],
        buckets: [0.1, 1],
      }),
      prevEpochAggregatesTotal: register.gauge<"index">({
        name: "validator_monitor_prev_epoch_aggregates_total",
        help: "The number of aggregates seen in the previous epoch",
        labelNames: ["index"],
      }),
      prevEpochAggregatesMinDelaySeconds: register.histogram<"index">({
        name: "validator_monitor_prev_epoch_aggregates_min_delay_seconds",
        help: "The min delay between when the validator should send the aggregate and when it was received",
        labelNames: ["index"],
        buckets: [0.1, 1],
      }),

      // Validator Monitor Metrics (real-time)

      unaggregatedAttestationTotal: register.gauge<"index" | "src">({
        name: "validator_monitor_unaggregated_attestation_total",
        help: "Number of unaggregated attestations seen",
        labelNames: ["index", "src"],
      }),
      unaggregatedAttestationDelaySeconds: register.histogram<"index" | "src">({
        name: "validator_monitor_unaggregated_attestation_delay_seconds",
        help: "The delay between when the validator should send the attestation and when it was received",
        labelNames: ["index", "src"],
        buckets: [0.1, 1],
      }),
      unaggregatedAttestationSubmittedSentPeers: register.histogram<"index">({
        name: "validator_monitor_unaggregated_attestation_submited_sent_peers_total",
        help: "Number of unaggregated attestations submitted by local validator that has no subnet peers",
        labelNames: ["index"],
        buckets: [0, 2, 5, 10],
      }),
      aggregatedAttestationTotal: register.gauge<"index" | "src">({
        name: "validator_monitor_aggregated_attestation_total",
        help: "Number of aggregated attestations seen",
        labelNames: ["index", "src"],
      }),
      aggregatedAttestationDelaySeconds: register.histogram<"index" | "src">({
        name: "validator_monitor_aggregated_attestation_delay_seconds",
        help: "The delay between then the validator should send the aggregate and when it was received",
        labelNames: ["index", "src"],
        buckets: [0.1, 1],
      }),
      attestationInAggregateTotal: register.gauge<"index" | "src">({
        name: "validator_monitor_attestation_in_aggregate_total",
        help: "Number of times an attestation has been seen in an aggregate",
        labelNames: ["index", "src"],
      }),
      attestationInAggregateDelaySeconds: register.histogram<"index" | "src">({
        name: "validator_monitor_attestation_in_aggregate_delay_seconds",
        help: "The delay between when the validator should send the aggregate and when it was received",
        labelNames: ["index", "src"],
        buckets: [0.1, 1],
      }),
      attestationInBlockTotal: register.gauge<"index">({
        name: "validator_monitor_attestation_in_block_total",
        help: "Number of times an attestation has been seen in a block",
        labelNames: ["index"],
      }),
      attestationInBlockDelaySlots: register.histogram<"index">({
        name: "validator_monitor_attestation_in_block_delay_slots",
        help: "The excess slots (beyond the minimum delay) between the attestation slot and the block slot",
        labelNames: ["index"],
        buckets: [0.1, 1],
      }),
      beaconBlockTotal: register.gauge<"index" | "src">({
        name: "validator_monitor_beacon_block_total",
        help: "Total number of beacon blocks seen",
        labelNames: ["index", "src"],
      }),
      beaconBlockDelaySeconds: register.histogram<"index" | "src">({
        name: "validator_monitor_beacon_block_delay_seconds",
        help: "The delay between when the validator should send the block and when it was received",
        labelNames: ["index", "src"],
        buckets: [0.1, 1],
      }),
    },

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
    unhandeledPromiseRejections: register.gauge({
      name: "lodestar_unhandeled_promise_rejections_total",
      help: "UnhandeledPromiseRejection total count",
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
      persistedUpdates: register.gauge<"type">({
        name: "lodestar_lightclient_server_persisted_updates_total",
        help: "Total number of persisted updates by finalized type",
        labelNames: ["type"],
      }),
    },
  };
}
