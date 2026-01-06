/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: The metric templates requires to have `${}` in a normal string */
import {NotReorgedReason} from "@lodestar/fork-choice";
import {ArchiveStoreTask} from "../../chain/archiveStore/archiveStore.js";
import {FrequencyStateArchiveStep} from "../../chain/archiveStore/strategies/frequencyStateArchiveStrategy.js";
import {BlockInputSource} from "../../chain/blocks/blockInput/index.js";
import {JobQueueItemType} from "../../chain/bls/index.js";
import {AttestationErrorCode, BlockErrorCode} from "../../chain/errors/index.js";
import {
  type InvalidAttestationData,
  ScannedSlotsTerminationReason,
} from "../../chain/opPools/aggregatedAttestationPool.js";
import {InsertOutcome} from "../../chain/opPools/types.js";
import {RegenCaller, RegenFnName} from "../../chain/regen/interface.js";
import {ReprocessStatus} from "../../chain/reprocess.js";
import {RejectReason} from "../../chain/seenCache/seenAttestationData.js";
import {CacheItemType} from "../../chain/stateCache/types.js";
import {OpSource} from "../../chain/validatorMonitor.js";
import {ExecutionPayloadStatus} from "../../execution/index.js";
import {GossipType} from "../../network/index.js";
import {CannotAcceptWorkReason, ReprocessRejectReason} from "../../network/processor/index.js";
import {BackfillSyncMethod} from "../../sync/backfill/backfill.js";
import {PendingBlockType} from "../../sync/types.js";
import {PeerSyncType, RangeSyncType} from "../../sync/utils/remoteSyncType.js";
import {AllocSource} from "../../util/bufferPool.js";
import {DataColumnReconstructionCode} from "../../util/dataColumns.js";
import {DataColumnEngineResult} from "../../util/execution.js";
import {LodestarMetadata} from "../options.js";
import {RegistryMetricCreator} from "../utils/registryMetricCreator.js";

export type LodestarMetrics = ReturnType<typeof createLodestarMetrics>;

/**
 * Extra Lodestar custom metrics
 */
export function createLodestarMetrics(
  register: RegistryMetricCreator,
  metadata?: LodestarMetadata,
  genesisTime?: number
) {
  if (metadata) {
    register.static<LodestarMetadata>({
      name: "lodestar_version",
      help: "Lodestar version",
      value: metadata,
    });
  }

  // Initial static metrics
  if (genesisTime) {
    register
      .gauge({
        name: "lodestar_genesis_time",
        help: "Genesis time in seconds",
      })
      .set(genesisTime);
  }

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
      jobTime: register.histogram<{topic: GossipType}>({
        name: "lodestar_gossip_validation_queue_job_time_seconds",
        help: "Time to process gossip validation queue job in seconds",
        labelNames: ["topic"],
        buckets: [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10],
      }),
      jobWaitTime: register.histogram<{topic: GossipType}>({
        name: "lodestar_gossip_validation_queue_job_wait_time_seconds",
        help: "Time from job added to the queue to starting the job in seconds",
        labelNames: ["topic"],
        buckets: [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10],
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
      queueTime: register.histogram({
        name: "lodestar_gossip_validation_queue_time_seconds",
        help: "Total time an item stays in queue until it is processed in seconds",
        buckets: [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 5],
      }),
    },

    networkProcessor: {
      gossipValidationAccept: register.gauge<{topic: GossipType}>({
        name: "lodestar_gossip_validation_accept_total",
        help: "Count of total gossip validation accept",
        labelNames: ["topic"],
      }),
      gossipValidationIgnore: register.gauge<{topic: GossipType}>({
        name: "lodestar_gossip_validation_ignore_total",
        help: "Count of total gossip validation ignore",
        labelNames: ["topic"],
      }),
      gossipValidationReject: register.gauge<{topic: GossipType}>({
        name: "lodestar_gossip_validation_reject_total",
        help: "Count of total gossip validation reject",
        labelNames: ["topic"],
      }),
      gossipValidationError: register.gauge<{topic: GossipType; error: string}>({
        name: "lodestar_gossip_validation_error_total",
        help: "Count of total gossip validation errors detailed",
        labelNames: ["topic", "error"],
      }),
      gossipAttestationIgnoreByReason: register.gauge<{reason: AttestationErrorCode}>({
        name: "lodestar_gossip_attestation_ignore_by_reason_total",
        help: "Count of total gossip attestation ignore by reason",
        labelNames: ["reason"],
      }),
      gossipAttestationRejectByReason: register.gauge<{reason: AttestationErrorCode}>({
        name: "lodestar_gossip_attestation_reject_by_reason_total",
        help: "Count of total gossip attestation reject by reason",
        labelNames: ["reason"],
      }),
      executeWorkCalls: register.gauge({
        name: "lodestar_network_processor_execute_work_calls_total",
        help: "Total calls to network processor execute work fn",
      }),
      jobsSubmitted: register.histogram({
        name: "lodestar_network_processor_execute_jobs_submitted_total",
        help: "Total calls to network processor execute work fn",
        buckets: [0, 1, 5, 128],
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
      responseTime: register.histogram<{operationId: string}>({
        name: "lodestar_api_rest_response_time_seconds",
        help: "REST API time to fulfill a request by operationId",
        labelNames: ["operationId"],
        // Request times range between 1ms to 100ms in normal conditions. Can get to 1-5 seconds if overloaded
        buckets: [0.01, 0.1, 1],
      }),
      requests: register.gauge<{operationId: string}>({
        name: "lodestar_api_rest_requests_total",
        help: "REST API total count requests by operationId",
        labelNames: ["operationId"],
      }),
      errors: register.gauge<{operationId: string}>({
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

    production: {
      producedAggregateParticipants: register.histogram({
        name: "lodestar_produced_aggregate_participants",
        help: "API impl produced aggregates histogram of participants",
        // We expect most aggregates to have 400-600 participants depending on the
        // validator count of the network, anything lower than that is not acceptable
        // Max committee sizes are: 1e6 vc: 488, 1.1e6 vc: 537, 1.4e6 vc: 683
        buckets: [1, 25, 50, 100, 250, 400, 500, 600],
      }),
      producedSyncContributionParticipants: register.histogram({
        name: "lodestar_produced_sync_contribution_participants",
        help: "API impl produced sync contribution histogram of participants",
        // We care more about tracking low quality aggregates with low participation
        // Max committee sizes fixed to 512/4 = 128
        buckets: [1, 5, 20, 50, 128],
      }),
      producedSyncAggregateParticipants: register.histogram({
        name: "lodestar_produced_sync_aggregate_participants",
        help: "API impl produced sync aggregate histogram of participants",
        // We care more about tracking low quality aggregates with low participation
        // Max committee sizes fixed to 512
        buckets: [1, 5, 20, 50, 100, 200, 512],
      }),
    },

    duties: {
      requestNextEpochProposalDutiesHit: register.gauge({
        name: "lodestar_duties_request_next_epoch_proposal_duties_hit_total",
        help: "Total count of requestNextEpochProposalDuties hit",
      }),
      requestNextEpochProposalDutiesMiss: register.gauge({
        name: "lodestar_duties_request_next_epoch_proposal_duties_miss_total",
        help: "Total count of requestNextEpochProposalDuties miss",
      }),
    },

    // Beacon state transition metrics

    epochTransitionByCaller: register.gauge<{caller: RegenCaller}>({
      name: "lodestar_epoch_transition_by_caller_total",
      help: "Total count of epoch transition by caller",
      labelNames: ["caller"],
    }),

    // BLS verifier thread pool and queue

    bls: {
      aggregatedPubkeys: register.gauge({
        name: "lodestar_bls_aggregated_pubkeys_total",
        help: "Total aggregated pubkeys for BLS validation",
      }),
    },

    blsThreadPool: {
      jobsWorkerTime: register.gauge<{workerId: number}>({
        name: "lodestar_bls_thread_pool_time_seconds_sum",
        help: "Total time spent verifying signature sets measured on the worker",
        labelNames: ["workerId"],
      }),
      successJobsSignatureSetsCount: register.gauge({
        name: "lodestar_bls_thread_pool_success_jobs_signature_sets_count",
        help: "Count of total verified signature sets",
      }),
      errorAggregateSignatureSetsCount: register.gauge<{type: JobQueueItemType}>({
        name: "lodestar_bls_thread_pool_error_aggregate_signature_sets_count",
        help: "Count of error when aggregating pubkeys or signatures",
        labelNames: ["type"],
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
      workersBusy: register.gauge({
        name: "lodestar_bls_thread_pool_workers_busy",
        help: "Count of current busy workers",
      }),
      totalJobsGroupsStarted: register.gauge({
        name: "lodestar_bls_thread_pool_job_groups_started_total",
        help: "Count of total jobs groups started in bls thread pool, job groups include +1 jobs",
      }),
      totalJobsStarted: register.gauge<{type: JobQueueItemType}>({
        name: "lodestar_bls_thread_pool_jobs_started_total",
        help: "Count of total jobs started in bls thread pool, jobs include +1 signature sets",
        labelNames: ["type"],
      }),
      totalSigSetsStarted: register.gauge<{type: JobQueueItemType}>({
        name: "lodestar_bls_thread_pool_sig_sets_started_total",
        help: "Count of total signature sets started in bls thread pool, sig sets include 1 pk, msg, sig",
        labelNames: ["type"],
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
      sameMessageRetryJobs: register.gauge({
        name: "lodestar_bls_thread_pool_same_message_jobs_retries_total",
        help: "Count of total same message jobs that failed and had to be verified again.",
      }),
      sameMessageRetrySets: register.gauge({
        name: "lodestar_bls_thread_pool_same_message_sets_retries_total",
        help: "Count of total same message sets that failed and had to be verified again.",
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
      totalSigSets: register.gauge({
        name: "lodestar_bls_thread_pool_sig_sets_total",
        help: "Count of total signature sets",
      }),
      prioritizedSigSets: register.gauge({
        name: "lodestar_bls_thread_pool_prioritized_sig_sets_total",
        help: "Count of total prioritized signature sets",
      }),
      batchableSigSets: register.gauge({
        name: "lodestar_bls_thread_pool_batchable_sig_sets_total",
        help: "Count of total batchable signature sets",
      }),
      aggregateWithRandomnessAsyncDuration: register.histogram({
        name: "lodestar_bls_thread_pool_aggregate_with_randomness_async_time_seconds",
        help: "Total time performing aggregateWithRandomness async",
        buckets: [0.001, 0.005, 0.01, 0.1, 0.3],
      }),
      pubkeysAggregationMainThreadDuration: register.histogram({
        name: "lodestar_bls_thread_pool_pubkeys_aggregation_main_thread_time_seconds",
        help: "Total time spent aggregating pubkeys on main thread",
        buckets: [0.001, 0.005, 0.01, 0.1],
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
    syncPeersBySyncType: register.gauge<{syncType: PeerSyncType}>({
      name: "lodestar_sync_range_sync_peers",
      help: "Count of peers by sync type [FullySynced, Advanced, Behind]",
      labelNames: ["syncType"],
    }),
    syncSwitchGossipSubscriptions: register.gauge<{action: string}>({
      name: "lodestar_sync_switch_gossip_subscriptions",
      help: "Sync switched gossip subscriptions on/off",
      labelNames: ["action"],
    }),

    syncRange: {
      syncChainsEvents: register.gauge<{syncType: RangeSyncType; event: string}>({
        name: "lodestar_sync_chains_events_total",
        help: "Total number of sync chains events events, labeled by syncType",
        labelNames: ["syncType", "event"],
      }),
      syncChains: register.gauge<{syncType: RangeSyncType}>({
        name: "lodestar_sync_chains_count",
        help: "Count of sync chains by syncType",
        labelNames: ["syncType"],
      }),
      syncChainsPeers: register.histogram<{syncType: RangeSyncType}>({
        name: "lodestar_sync_chains_peer_count_by_type",
        help: "Count of sync chain peers by syncType",
        labelNames: ["syncType"],
        buckets: [0, 2, 5, 15, 50],
      }),
      syncChainHighestTargetSlotCompleted: register.gauge({
        name: "lodestar_sync_chain_highest_target_slot_completed",
        help: "Highest target slot completed by a sync chain",
      }),
      headSyncPeers: register.gauge<{columnIndex: number}>({
        name: "lodestar_sync_head_sync_peers_count",
        help: "Count of head sync peers by group index",
        labelNames: ["columnIndex"],
      }),
      finalizedSyncPeers: register.gauge<{columnIndex: number}>({
        name: "lodestar_sync_finalized_sync_peers_count",
        help: "Count of finalized sync peers by group index",
        labelNames: ["columnIndex"],
      }),
      downloadByRange: {
        success: register.gauge({
          name: "lodestar_sync_range_download_by_range_success_total",
          help: "Total number of successful downloadByRange calls",
        }),
        error: register.gauge<{code: string; client: string}>({
          name: "lodestar_sync_range_download_by_range_error_total",
          help: "Total number of errored downloadByRange calls",
          labelNames: ["code", "client"],
        }),
        warn: register.gauge<{code: string; client: string}>({
          name: "lodestar_sync_range_download_by_range_warn_total",
          help: "Total number of downloadByRange call warnings",
          labelNames: ["code", "client"],
        }),
      },
    },

    blockInputSync: {
      switchNetworkSubscriptions: register.gauge<{action: string}>({
        name: "lodestar_sync_unknown_block_network_subscriptions_count",
        help: "Switch network subscriptions on/off",
        labelNames: ["action"],
      }),
      requests: register.gauge<{type: PendingBlockType}>({
        name: "lodestar_sync_unknown_block_requests_total",
        help: "Total number of unknown block events or requests",
        labelNames: ["type"],
      }),
      source: register.gauge<{source: BlockInputSource}>({
        name: "lodestar_block_input_sync_source_total",
        help: "The origination source of one of the BlockInputSync triggers",
        labelNames: ["source"],
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
      elapsedTimeTillReceived: register.histogram({
        name: "lodestar_sync_unknown_block_elapsed_time_till_received",
        help: "Time elapsed between block slot time and the time block received via unknown block sync",
        buckets: [0.5, 1, 2, 4, 6, 12],
      }),
      resolveAvailabilitySource: register.gauge<{source: BlockInputSource}>({
        name: "lodestar_sync_blockinput_availability_source",
        help: "Total number of blocks whose data availability was resolved",
        labelNames: ["source"],
      }),
      fetchBegin: register.histogram({
        name: "lodestar_sync_unknown_block_fetch_begin_since_slot_start_seconds",
        help: "Time into the slot when the block was fetched",
        buckets: [0, 1, 2, 4],
      }),
      // we may not have slot in case of failure, so track fetch time from start to done (either success or failure)
      fetchTimeSec: register.histogram<{result: string}>({
        name: "lodestar_sync_unknown_block_fetch_time_seconds",
        help: "Fetch time from start to done (either success or failure)",
        labelNames: ["result"],
        buckets: [0, 1, 2, 4, 8],
      }),
      fetchPeers: register.gauge<{result: string}>({
        name: "lodestar_sync_unknown_block_fetch_peers_count",
        help: "Number of peers that node fetched from",
        labelNames: ["result"],
      }),
      downloadByRoot: {
        success: register.gauge({
          name: "lodestar_sync_unknown_block_download_by_root_success_total",
          help: "Total number of successful downloadByRoot calls",
        }),
        error: register.gauge<{code: string; client: string}>({
          name: "lodestar_sync_unknown_block_download_by_root_error_total",
          help: "Total number of errored downloadByRoot calls",
          labelNames: ["code", "client"],
        }),
        warn: register.gauge<{code: string; client: string}>({
          name: "lodestar_sync_unknown_block_download_by_root_warn_total",
          help: "Total number of downloadByRoot call warnings",
          labelNames: ["code", "client"],
        }),
      },
      peerBalancer: {
        peersMetaCount: register.gauge({
          name: "lodestar_sync_unknown_block_peer_balancer_peers_meta_count",
          help: "Count of peers meta in UnknownBlockSync peer balancer",
        }),
        peersActiveRequestCount: register.gauge({
          name: "lodestar_sync_unknown_block_peer_balancer_peers_active_request_count",
          help: "Count of peers active requests in UnknownBlockSync peer balancer",
        }),
        totalActiveRequests: register.gauge({
          name: "lodestar_sync_unknown_block_peer_balancer_total_active_requests",
          help: "Total active requests in UnknownBlockSync peer balancer",
        }),
      },
    },

    // Gossip sync committee
    gossipSyncCommittee: {
      equivocationCount: register.counter({
        name: "lodestar_gossip_sync_committee_equivocation_count",
        help: "Count of sync committee messages with same validator index for different block roots",
      }),
      equivocationToHeadCount: register.counter({
        name: "lodestar_gossip_sync_committee_equivocation_to_head_count",
        help: "Count of sync committee messages which conflict to a previous message but elect the head",
      }),
    },

    // Gossip attestation
    gossipAttestation: {
      useHeadBlockState: register.gauge<{caller: RegenCaller}>({
        name: "lodestar_gossip_attestation_use_head_block_state_count",
        help: "Count of gossip attestation verification using head block state",
        labelNames: ["caller"],
      }),
      useHeadBlockStateDialedToTargetEpoch: register.gauge<{caller: RegenCaller}>({
        name: "lodestar_gossip_attestation_use_head_block_state_dialed_to_target_epoch_count",
        help: "Count of gossip attestation verification using head block state and dialed to target epoch",
        labelNames: ["caller"],
      }),
      headSlotToAttestationSlot: register.histogram<{caller: RegenCaller}>({
        name: "lodestar_gossip_attestation_head_slot_to_attestation_slot",
        help: "Slot distance between attestation slot and head slot",
        labelNames: ["caller"],
        buckets: [0, 1, 2, 4, 8, 16, 32, 64],
      }),
      shufflingCacheHit: register.gauge<{caller: RegenCaller}>({
        name: "lodestar_gossip_attestation_shuffling_cache_hit_count",
        help: "Count of gossip attestation verification shuffling cache hit",
        labelNames: ["caller"],
      }),
      shufflingCacheMiss: register.gauge<{caller: RegenCaller}>({
        name: "lodestar_gossip_attestation_shuffling_cache_miss_count",
        help: "Count of gossip attestation verification shuffling cache miss",
        labelNames: ["caller"],
      }),
      shufflingCacheRegenHit: register.gauge<{caller: RegenCaller}>({
        name: "lodestar_gossip_attestation_shuffling_cache_regen_hit_count",
        help: "Count of gossip attestation verification shuffling cache regen hit",
        labelNames: ["caller"],
      }),
      shufflingCacheRegenMiss: register.gauge<{caller: RegenCaller}>({
        name: "lodestar_gossip_attestation_shuffling_cache_regen_miss_count",
        help: "Count of gossip attestation verification shuffling cache regen miss",
        labelNames: ["caller"],
      }),
      attestationSlotToClockSlot: register.histogram<{caller: RegenCaller}>({
        name: "lodestar_gossip_attestation_attestation_slot_to_clock_slot",
        help: "Slot distance between clock slot and attestation slot",
        labelNames: ["caller"],
        buckets: [0, 1, 2, 4, 8, 16, 32, 64],
      }),
      attestationBatchHistogram: register.histogram({
        name: "lodestar_gossip_attestation_verified_in_batch_histogram",
        help: "Number of attestations verified in batch",
        buckets: [1, 2, 4, 8, 16, 32, 64, 128],
      }),
      attestationNonBatchCount: register.gauge({
        name: "lodestar_gossip_attestation_verified_non_batch_count",
        help: "Count of attestations NOT verified in batch",
      }),
    },

    // Gossip block
    gossipBlock: {
      elapsedTimeTillReceived: register.histogram<{source: OpSource}>({
        name: "lodestar_gossip_block_elapsed_time_till_received",
        help: "Time elapsed between block slot time and the time block received via gossip",
        labelNames: ["source"],
        buckets: [0.5, 1, 2, 4, 6, 12],
      }),
      elapsedTimeTillProcessed: register.histogram({
        name: "lodestar_gossip_block_elapsed_time_till_processed",
        help: "Time elapsed between block slot time and the time block processed",
        buckets: [0.5, 1, 2, 4, 6, 12],
      }),

      gossipValidation: {
        recvToValidation: register.histogram({
          name: "lodestar_gossip_block_received_to_gossip_validate",
          help: "Time elapsed between block received and block validated",
          buckets: [0.05, 0.1, 0.3, 0.5, 0.7, 1, 1.3, 1.6, 2, 2.5, 3, 3.5, 4],
        }),
        validationTime: register.histogram({
          name: "lodestar_gossip_block_gossip_validate_time",
          help: "Time to apply gossip validations",
          buckets: [0.05, 0.1, 0.3, 0.5, 0.7, 1, 1.3, 1.6, 2, 2.5, 3, 3.5, 4],
        }),
      },
      stateTransition: {
        recvToValidation: register.histogram({
          name: "lodestar_gossip_block_received_to_state_transition",
          help: "Time elapsed between block received and block state transition",
          buckets: [0.05, 0.1, 0.3, 0.5, 0.7, 1, 1.3, 1.6, 2, 2.5, 3, 3.5, 4],
        }),
        validationTime: register.histogram({
          name: "lodestar_gossip_block_state_transition_time",
          help: "Time to validate block state transition",
          buckets: [0.05, 0.1, 0.3, 0.5, 0.7, 1, 1.3, 1.6, 2, 2.5, 3, 3.5, 4],
        }),
      },
      signatureVerification: {
        recvToValidation: register.histogram({
          name: "lodestar_gossip_block_received_to_signatures_verification",
          help: "Time elapsed between block received and block signatures verification",
          buckets: [0.05, 0.1, 0.3, 0.5, 0.7, 1, 1.3, 1.6, 2, 2.5, 3, 3.5, 4],
        }),
        validationTime: register.histogram({
          name: "lodestar_gossip_block_signatures_verification_time",
          help: "Time elapsed for block signatures verification",
          buckets: [0.05, 0.1, 0.3, 0.5, 0.7, 1, 1.3, 1.6, 2, 2.5, 3, 3.5, 4],
        }),
      },
      executionPayload: {
        recvToValidation: register.histogram({
          name: "lodestar_gossip_block_received_to_execution_payload_verification",
          help: "Time elapsed between block received and execution payload verification",
          buckets: [0.05, 0.1, 0.3, 0.5, 0.7, 1, 1.3, 1.6, 2, 2.5, 3, 3.5, 4],
        }),
        validationTime: register.histogram({
          name: "lodestar_gossip_execution_payload_verification_time",
          help: "Time elapsed for execution payload verification",
          buckets: [0.05, 0.1, 0.3, 0.5, 0.7, 1, 1.3, 1.6, 2, 2.5, 3, 3.5, 4],
        }),
      },
      blockImport: {
        recvToValidation: register.histogram({
          name: "lodestar_gossip_block_received_to_block_import",
          help: "Time elapsed between block received and block import",
          buckets: [0.05, 0.1, 0.3, 0.5, 0.7, 1, 1.3, 1.6, 2, 2.5, 3, 3.5, 4],
        }),
        validationTime: register.histogram({
          name: "lodestar_gossip_block_block_import_time",
          help: "Time elapsed for block import",
          buckets: [0.05, 0.1, 0.3, 0.5, 0.7, 1, 1.3, 1.6, 2, 2.5, 3, 3.5, 4],
        }),
      },

      receivedToBlobsAvailabilityTime: register.histogram<{numBlobs: number}>({
        name: "lodestar_gossip_block_received_to_blobs_availability_time",
        help: "Time elapsed between block received and blobs became available",
        buckets: [0.05, 0.1, 0.3, 0.5, 0.7, 1, 1.3, 1.6, 2, 2.5, 3, 3.5, 4],
        labelNames: ["numBlobs"],
      }),
      receivedToFullyVerifiedTime: register.histogram({
        name: "lodestar_gossip_block_received_to_fully_verified_time",
        help: "Time elapsed between block received and fully verified state, signatures and payload",
        buckets: [0.05, 0.1, 0.3, 0.5, 0.7, 1, 1.3, 1.6, 2, 2.5, 3, 3.5, 4],
      }),
      verifiedToBlobsAvailabiltyTime: register.histogram<{numBlobs: number}>({
        name: "lodestar_gossip_block_verified_to_blobs_availability_time",
        help: "Time elapsed between block verified and blobs became available",
        buckets: [0.05, 0.1, 0.3, 0.5, 0.7, 1, 1.3, 1.6, 2, 2.5, 3, 3.5, 4],
        labelNames: ["numBlobs"],
      }),

      processBlockErrors: register.gauge<{error: BlockErrorCode | "NOT_BLOCK_ERROR"}>({
        name: "lodestar_gossip_block_process_block_errors",
        help: "Count of errors, by error type, while processing blocks",
        labelNames: ["error"],
      }),
    },
    gossipBlob: {
      recvToValidation: register.histogram({
        name: "lodestar_gossip_blob_received_to_gossip_validate",
        help: "Time elapsed between blob received and blob validation",
        buckets: [0.05, 0.1, 0.2, 0.5, 1, 1.5, 2, 4],
      }),
      validationTime: register.histogram({
        name: "lodestar_gossip_blob_gossip_validate_time",
        help: "Time elapsed for blob validation",
        buckets: [0.05, 0.1, 0.2, 0.5, 1, 1.5, 2, 4],
      }),
      publishedFromEngine: register.counter({
        name: "lodestar_gossip_blob_published_from_engine_total",
        help: "Total number of blobs retrieved from execution engine and published to gossip",
      }),
    },
    recoverDataColumnSidecars: {
      recoverTime: register.histogram({
        name: "lodestar_recover_data_column_sidecar_recover_time_seconds",
        help: "Time elapsed to recover data column sidecar",
        buckets: [0.5, 1.0, 1.5, 2],
      }),
      custodyBeforeReconstruction: register.gauge({
        name: "lodestar_data_columns_in_custody_before_reconstruction",
        help: "Number of data columns in custody before reconstruction",
      }),
      numberOfColumnsRecovered: register.gauge({
        name: "lodestar_recover_data_column_sidecar_recovered_columns_total",
        help: "Total number of columns that were recovered",
      }),
      reconstructionResult: register.counter<{result: DataColumnReconstructionCode}>({
        name: "lodestar_data_column_sidecars_reconstruction_result",
        help: "Data column sidecars reconstruction result",
        labelNames: ["result"],
      }),
    },
    dataColumns: {
      bySource: register.gauge<{source: BlockInputSource}>({
        name: "lodestar_data_columns_by_source",
        help: "Number of received data columns by source",
        labelNames: ["source"],
      }),
      elapsedTimeTillReceived: register.histogram<{receivedOrder: number}>({
        name: "lodestar_data_column_elapsed_time_till_received_seconds",
        help: "Time elapsed between block slot time and the time data column received",
        labelNames: ["receivedOrder"],
        buckets: [1, 2, 3, 4, 6, 12],
      }),
      sentPeersPerSubnet: register.histogram({
        name: "lodestar_data_column_sent_peers_per_subnet",
        help: "Number of peers node sent per subnet when publishing DataColumnSidecars",
        // given TARGET_GROUP_PEERS_PER_SUBNET = 4, we expect sending to 4 peers per subnet
        buckets: [1, 2, 3, 4],
      }),
      missingCustodyColumns: register.counter({
        name: "lodestar_data_columns_missing_custody_columns_count",
        help: "Total number of missing columns that should be in the database but were not when requested",
      }),
      dataColumnEngineResult: register.counter<{result: DataColumnEngineResult}>({
        name: "lodestar_data_column_engine_result_total",
        help: "The total result of sending data column to execution layer",
        labelNames: ["result"],
      }),
    },
    importBlock: {
      persistBlockNoSerializedDataCount: register.gauge({
        name: "lodestar_import_block_persist_block_no_serialized_data_count",
        help: "Count persisting block with no serialized data",
      }),
      persistBlockWithSerializedDataCount: register.gauge({
        name: "lodestar_import_block_persist_block_with_serialized_data_count",
        help: "Count persisting block with serialized data",
      }),
      elapsedTimeTillBecomeHead: register.histogram({
        name: "lodestar_gossip_block_elapsed_time_till_become_head",
        help: "Time elapsed between block slot time and the time block becomes head",
        buckets: [0.5, 1, 2, 4, 6, 12],
      }),
      setHeadAfterCutoff: register.gauge({
        name: "lodestar_import_block_set_head_after_cutoff_total",
        help: "Total times an imported block is set as head after ATTESTATION_DUE_BPS of the slot",
      }),
      bySource: register.gauge<{source: BlockInputSource}>({
        name: "lodestar_import_block_by_source_total",
        help: "Total number of imported blocks by source",
        labelNames: ["source"],
      }),
      blobsBySource: register.gauge<{blobsSource: BlockInputSource}>({
        name: "lodestar_import_blobs_by_source_total",
        help: "Total number of imported blobs by source",
        labelNames: ["blobsSource"],
      }),
      columnsBySource: register.gauge<{source: BlockInputSource}>({
        name: "lodestar_import_columns_by_source_total",
        help: "Total number of imported columns (sampled columns) by source",
        labelNames: ["source"],
      }),
      notOverrideFcuReason: register.counter<{reason: NotReorgedReason}>({
        name: "lodestar_import_block_not_override_fcu_reason_total",
        help: "Reason why the fcu call is not suppressed during block import",
        labelNames: ["reason"],
      }),
    },
    engineNotifyNewPayloadResult: register.gauge<{result: ExecutionPayloadStatus}>({
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
      totalBlocks: register.gauge<{method: BackfillSyncMethod}>({
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
      aggregatedAttestationPool: {
        size: register.gauge({
          name: "lodestar_oppool_aggregated_attestation_pool_size",
          help: "Current size of the AggregatedAttestationPool = total attestations",
        }),
        uniqueData: register.gauge({
          name: "lodestar_oppool_aggregated_attestation_pool_unique_data_count",
          help: "Current size of the AggregatedAttestationPool = total attestations unique by data",
        }),
        attDataPerSlot: register.gauge({
          name: "lodestar_oppool_aggregated_attestation_pool_attestation_data_per_slot_total",
          help: "Total number of attestation data per slot in AggregatedAttestationPool",
        }),
        committeesPerSlot: register.gauge({
          name: "lodestar_oppool_aggregated_attestation_pool_committees_per_slot_total",
          help: "Total number of committees per slot in AggregatedAttestationPool",
        }),
        // max number of attestations per committee will become number of consolidations
        maxAttestationsPerCommittee: register.gauge({
          name: "lodestar_oppool_aggregated_attestation_pool_max_attestations_per_committee",
          help: "Max number of attestations per committee in AggregatedAttestationPool",
        }),
        attestationsPerCommittee: register.histogram({
          name: "lodestar_oppool_aggregated_attestation_pool_attestations_per_committee",
          help: "Number of attestations per committee in AggregatedAttestationPool",
          buckets: [0, 2, 4, 8],
        }),
        gossipInsertOutcome: register.counter<{insertOutcome: InsertOutcome}>({
          name: "lodestar_oppool_aggregated_attestation_pool_gossip_insert_outcome_total",
          help: "Total number of InsertOutcome as a result of adding an aggregated attestation from gossip in the pool",
          labelNames: ["insertOutcome"],
        }),
        apiInsertOutcome: register.counter<{insertOutcome: InsertOutcome}>({
          name: "lodestar_oppool_aggregated_attestation_pool_api_insert_outcome_total",
          help: "Total number of InsertOutcome as a result of adding an aggregated attestation from api in the pool",
          labelNames: ["insertOutcome"],
        }),
        packedAttestations: {
          committeeCount: register.gauge<{index: number}>({
            name: "lodestar_oppool_aggregated_attestation_pool_packed_attestations_committee_count",
            help: "Total number of committees in packed attestation ${index}",
            labelNames: ["index"],
          }),
          totalAttesters: register.gauge<{index: number}>({
            name: "lodestar_oppool_aggregated_attestation_pool_packed_attestations_attesters_total",
            help: "Total number of attesters in packed attestation ${index}",
            labelNames: ["index"],
          }),
          nonParticipation: register.gauge<{index: number}>({
            name: "lodestar_oppool_aggregated_attestation_pool_packed_attestations_non_participation_total",
            help: "Total number of not seen attesters in packed attestation ${index}",
            labelNames: ["index"],
          }),
          newSeenAttesters: register.gauge<{index: number}>({
            name: "lodestar_oppool_aggregated_attestation_pool_packed_attestations_new_seen_attesters_total",
            help: "Total number of new seen attesters in packed attestation ${index}",
            labelNames: ["index"],
          }),
          totalEffectiveBalance: register.gauge<{index: number}>({
            name: "lodestar_oppool_aggregated_attestation_pool_packed_attestations_effective_balance_total",
            help: "Total effective balance of new seen attesters in packed attestation ${index}",
            labelNames: ["index"],
          }),
          inclusionDistance: register.gauge<{index: number}>({
            name: "lodestar_oppool_aggregated_attestation_pool_packed_attestations_inclusion_distance_total",
            help: "How far the packed attestation ${index} slot is from the block slot",
            labelNames: ["index"],
          }),
          scannedSlots: register.gauge<{reason: ScannedSlotsTerminationReason}>({
            name: "lodestar_oppool_aggregated_attestation_pool_packed_attestations_scanned_slots_total",
            help: "Total number of scanned slots to produce packed attestations",
            labelNames: ["reason"],
          }),
          scannedAttestations: register.gauge<{inclusionDistance: number}>({
            name: "lodestar_oppool_aggregated_attestation_pool_packed_attestations_scanned_attestations_total",
            help: "Total number of scanned attestations per scanned slot to produce packed attestations",
            labelNames: ["inclusionDistance"],
          }),
          returnedAttestations: register.gauge<{inclusionDistance: number}>({
            name: "lodestar_oppool_aggregated_attestation_pool_packed_attestations_returned_attestations_total",
            help: "Total number of returned attestations per scanned slot to produce packed attestations",
            labelNames: ["inclusionDistance"],
          }),
          poolSlots: register.gauge({
            name: "lodestar_oppool_aggregated_attestation_pool_packed_attestations_pool_slots_total",
            help: "Total number of slots in pool when producing packed attestations",
          }),
          totalConsolidations: register.gauge({
            name: "lodestar_oppool_aggregated_attestation_pool_packed_attestations_total_consolidations_total",
            help: "Total number of consolidations before truncate",
          }),
          emptyAttestationData: register.gauge({
            name: "lodestar_oppool_aggregated_attestation_pool_packed_attestations_empty_attestation_data_total",
            help: "Total number of attestation data with no group when producing packed attestation",
          }),
          invalidAttestationData: register.gauge<{reason: InvalidAttestationData}>({
            name: "lodestar_oppool_aggregated_attestation_pool_packed_attestations_invalid_attestation_data_total",
            help: "Total number of invalid attestation data when producing packed attestation",
            labelNames: ["reason"],
          }),
          seenCommittees: register.gauge({
            name: "lodestar_oppool_aggregated_attestation_pool_packed_attestations_seen_committees_total",
            help: "Total number of committees for which all members are seen when producing packed attestations",
          }),
        },
      },
      attestationPool: {
        size: register.gauge({
          name: "lodestar_oppool_attestation_pool_size",
          help: "Current size of the AttestationPool = total attestations unique by data and slot",
        }),
        gossipInsertOutcome: register.counter<{insertOutcome: InsertOutcome}>({
          name: "lodestar_oppool_attestation_pool_gossip_insert_outcome_total",
          help: "Total number of InsertOutcome as a result of adding a single attestation from gossip to the pool",
          labelNames: ["insertOutcome"],
        }),
        apiInsertOutcome: register.counter<{insertOutcome: InsertOutcome}>({
          name: "lodestar_oppool_attestation_pool_api_insert_outcome_total",
          help: "Total number of InsertOutcome as a result of adding a single attestation from api to the pool",
          labelNames: ["insertOutcome"],
        }),
        getAggregateCacheMisses: register.counter({
          name: "lodestar_oppool_attestation_pool_get_aggregate_cache_misses_total",
          help: "Total number of getAggregate calls with no aggregate for slot, attestation data root, and committee index",
        }),
      },
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
      syncCommitteeMessagePoolInsertOutcome: register.counter<{insertOutcome: InsertOutcome}>({
        name: "lodestar_oppool_sync_committee_message_insert_outcome_total",
        help: "Total number of InsertOutcome as a result of adding a SyncCommitteeMessage to pool",
        labelNames: ["insertOutcome"],
      }),
      syncContributionAndProofPool: {
        size: register.gauge({
          name: "lodestar_oppool_sync_contribution_and_proof_pool_size",
          help: "Current size of the SyncContributionAndProofPool unique by slot subnet and block root",
        }),
        gossipInsertOutcome: register.counter<{insertOutcome: InsertOutcome}>({
          name: "lodestar_oppool_sync_contribution_and_proof_pool_gossip_insert_outcome_total",
          help: "Total number of InsertOutcome as a result of adding a ContributionAndProof from gossip into the pool",
          labelNames: ["insertOutcome"],
        }),
        apiInsertOutcome: register.counter<{insertOutcome: InsertOutcome}>({
          name: "lodestar_oppool_sync_contribution_and_proof_pool_api_insert_outcome_total",
          help: "Total number of InsertOutcome as a result of adding a ContributionAndProof from api into the pool",
          labelNames: ["insertOutcome"],
        }),
        blockRootsPerSlot: register.gauge({
          name: "lodestar_oppool_sync_contribution_and_proof_pool_block_roots_per_slot_total",
          help: "Total number of block roots per slot in SyncContributionAndProofPool",
        }),
        subnetsByBlockRoot: register.gauge<{index: number}>({
          name: "lodestar_oppool_sync_contribution_and_proof_pool_subnets_by_block_root_total",
          help: "Total number of subnets per block root in SyncContributionAndProofPool",
          labelNames: ["index"],
        }),
        participantsByBlockRoot: register.gauge<{index: number}>({
          name: "lodestar_oppool_sync_contribution_and_proof_pool_participants_by_block_root_total",
          help: "Total number of participants per block root in SyncContributionAndProofPool",
          labelNames: ["index"],
        }),
        getAggregateRoots: register.gauge({
          name: "lodestar_oppool_sync_contribution_and_proof_pool_get_aggregate_roots_total",
          help: "Total number of block roots in SyncContributionAndProofPool.getAggregate(slot)",
        }),
        getAggregateSubnets: register.gauge({
          name: "lodestar_oppool_sync_contribution_and_proof_pool_get_aggregate_subnets_total",
          help: "Total number of subnets in SyncContributionAndProofPool.getAggregate(slot, root)",
        }),
        getAggregateParticipants: register.gauge({
          name: "lodestar_oppool_sync_contribution_and_proof_pool_get_aggregate_participants_total",
          help: "Total number of participants in SyncContributionAndProofPool.getAggregate(slot, root)",
        }),
        getAggregateReturnsEmpty: register.gauge({
          name: "lodestar_oppool_sync_contribution_and_proof_pool_get_aggregate_returns_empty_total",
          help: "Total number of empty returns in SyncContributionAndProofPool.getAggregate(slot, root)",
        }),
      },
    },

    chain: {
      blacklistedBlocks: register.gauge({
        name: "lodestar_blacklisted_blocks_total",
        help: "Total number of blacklisted blocks",
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

    bufferPool: {
      length: register.gauge({
        name: "lodestar_buffer_pool_length",
        help: "Buffer pool length",
      }),
      hits: register.counter<{source: AllocSource}>({
        name: "lodestar_buffer_pool_hits_total",
        help: "Total number of buffer pool hits",
        labelNames: ["source"],
      }),
      misses: register.counter<{source: AllocSource}>({
        name: "lodestar_buffer_pool_misses_total",
        help: "Total number of buffer pool misses",
        labelNames: ["source"],
      }),
      grows: register.counter({
        name: "lodestar_buffer_pool_grows_total",
        help: "Total number of buffer pool length increases",
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
      size: register.gauge<{type: CacheItemType}>({
        name: "lodestar_cp_state_cache_size",
        help: "Checkpoint state cache size",
        labelNames: ["type"],
      }),
      epochSize: register.gauge<{type: CacheItemType}>({
        name: "lodestar_cp_state_epoch_size",
        help: "Checkpoint state cache size",
        labelNames: ["type"],
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
      numStatesUpdated: register.histogram({
        name: "lodestar_cp_state_cache_state_updated_count",
        help: "Histogram of number of state cache items updated every time removing and adding pubkeys to pubkey cache",
        buckets: [1, 2, 5, 10, 50, 250],
      }),
      statePruneFromMemoryCount: register.gauge({
        name: "lodestar_cp_state_cache_state_prune_from_memory_count",
        help: "Total number of states pruned from memory",
      }),
      statePersistSecFromSlot: register.histogram({
        name: "lodestar_cp_state_cache_state_persist_seconds_from_slot",
        help: "Histogram of time to persist state to db since the clock slot",
        buckets: [0, 2, 4, 6, 8, 10, 12],
      }),
      stateReloadValidatorsSerializeDuration: register.histogram({
        name: "lodestar_cp_state_cache_state_reload_validators_serialize_seconds",
        help: "Histogram of time to serialize validators",
        buckets: [0.1, 0.2, 0.5, 1],
      }),
      stateReloadValidatorsSerializeAllocCount: register.counter({
        name: "lodestar_cp_state_cache_state_reload_validators_serialize_alloc_count",
        help: "Total number time to allocate memory for validators serialization",
      }),
      stateReloadShufflingCacheMiss: register.counter({
        name: "lodestar_cp_state_cache_state_reload_shuffling_cache_miss_count",
        help: "Total number of shuffling cache misses when loading a state",
      }),
      stateReloadDuration: register.histogram({
        name: "lodestar_cp_state_cache_state_reload_seconds",
        help: "Histogram of time to load state from db",
        buckets: [0, 2, 4, 6, 8, 10, 12],
      }),
      stateReloadEpochDiff: register.histogram({
        name: "lodestar_cp_state_cache_state_reload_epoch_diff",
        help: "Histogram of epoch difference between seed state epoch and loaded state epoch",
        buckets: [0, 1, 2, 4, 8, 16, 32],
      }),
      stateReloadSecFromSlot: register.histogram({
        name: "lodestar_cp_state_cache_state_reload_seconds_from_slot",
        help: "Histogram of time to load state from db since the clock slot",
        buckets: [0, 2, 4, 6, 8, 10, 12],
      }),
      stateReloadDbReadTime: register.histogram({
        name: "lodestar_cp_state_cache_state_reload_db_read_seconds",
        help: "Histogram of time to load state bytes from db",
        buckets: [0.01, 0.05, 0.1, 0.2, 0.5],
      }),
      persistedStateRemoveCount: register.gauge({
        name: "lodestar_cp_state_cache_persisted_state_remove_count",
        help: "Total number of persisted states removed",
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
      closestStateResult: register.counter<{stateId: string}>({
        name: "lodestar_balances_cache_closest_state_result_total",
        help: "Total number of stateIds returned as closest justified balances state by id",
        labelNames: ["stateId"],
      }),
    },

    shufflingCache: {
      size: register.gauge({
        name: "lodestar_shuffling_cache_size",
        help: "Shuffling cache size",
      }),
      insertPromiseCount: register.gauge({
        name: "lodestar_shuffling_cache_insert_promise_count",
        help: "Total number of times insertPromise is called",
      }),
      hit: register.gauge({
        name: "lodestar_shuffling_cache_hit_count",
        help: "Count of shuffling cache hit",
      }),
      miss: register.gauge({
        name: "lodestar_shuffling_cache_miss_count",
        help: "Count of shuffling cache miss",
      }),
      shufflingBuiltMultipleTimes: register.gauge({
        name: "lodestar_shuffling_cache_recalculated_shuffling_count",
        help: "Count of shuffling that were build multiple times",
      }),
      shufflingPromiseNotResolvedAndThrownAway: register.gauge({
        name: "lodestar_shuffling_cache_promise_not_resolved_and_thrown_away_count",
        help: "Count of shuffling cache promises that were discarded and the shuffling was built synchronously",
      }),
      shufflingPromiseNotResolved: register.gauge({
        name: "lodestar_shuffling_cache_promise_not_resolved_count",
        help: "Count of shuffling cache promises that were requested before the promise was resolved",
      }),
      nextShufflingNotOnEpochCache: register.gauge({
        name: "lodestar_shuffling_cache_next_shuffling_not_on_epoch_cache",
        help: "The next shuffling was not on the epoch cache before the epoch transition",
      }),
      shufflingPromiseResolutionTime: register.histogram({
        name: "lodestar_shuffling_cache_promise_resolution_time_seconds",
        help: "Time from promise insertion until promise resolution when shuffling was ready in seconds",
        buckets: [0.5, 1, 1.5, 2],
      }),
      shufflingCalculationTime: register.histogram<{source: "build" | "getSync"}>({
        name: "lodestar_shuffling_cache_shuffling_calculation_time_seconds",
        help: "Run time of shuffling calculation",
        buckets: [0.5, 0.75, 1, 1.25, 1.5],
        labelNames: ["source"],
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
      attestationData: {
        totalSlot: register.gauge({
          name: "lodestar_seen_cache_attestation_data_slot_total",
          help: "Total number of slots of attestation data in SeenAttestationData",
        }),
        countPerSlot: register.gauge({
          name: "lodestar_seen_cache_attestation_data_per_slot_total",
          help: "Total number of attestation data per slot in SeenAttestationData",
        }),
        hit: register.gauge({
          name: "lodestar_seen_cache_attestation_data_hit_total",
          help: "Total number of attestation data hit in SeenAttestationData",
        }),
        miss: register.gauge({
          name: "lodestar_seen_cache_attestation_data_miss_total",
          help: "Total number of attestation data miss in SeenAttestationData",
        }),
        reject: register.gauge<{reason: RejectReason}>({
          name: "lodestar_seen_cache_attestation_data_reject_total",
          help: "Total number of attestation data rejected in SeenAttestationData",
          labelNames: ["reason"],
        }),
      },
      blockInput: {
        blockInputCount: register.gauge({
          name: "lodestar_seen_block_input_cache_size",
          help: "Number of cached BlockInputs",
        }),
        duplicateBlockCount: register.gauge<{source: BlockInputSource}>({
          name: "lodestar_seen_block_input_cache_duplicate_block_count",
          help: "Total number of duplicate blocks that pass validation and attempt to be cached but are known",
          labelNames: ["source"],
        }),
        duplicateBlobCount: register.gauge<{source: BlockInputSource}>({
          name: "lodestar_seen_block_input_cache_duplicate_blob_count",
          help: "Total number of duplicate blobs that pass validation and attempt to be cached but are known",
          labelNames: ["source"],
        }),
        duplicateColumnCount: register.gauge<{source: BlockInputSource}>({
          name: "lodestar_seen_block_input_cache_duplicate_column_count",
          help: "Total number of duplicate columns that pass validation and attempt to be cached but are known",
          labelNames: ["source"],
        }),
        createdByBlock: register.gauge({
          name: "lodestar_seen_block_input_cache_items_created_by_block",
          help: "Number of BlockInputs created via a block being seen first",
        }),
        createdByBlob: register.gauge({
          name: "lodestar_seen_block_input_cache_items_created_by_blob",
          help: "Number of BlockInputs created via a blob being seen first",
        }),
      },
    },

    processFinalizedCheckpoint: {
      durationByTask: register.histogram<{source: ArchiveStoreTask}>({
        name: "lodestar_process_finalized_checkpoint_seconds",
        help: "Histogram of time to process finalized checkpoint",
        buckets: [0.1, 0.5, 1, 2, 4, 8],
        labelNames: ["source"],
      }),
      frequencyStateArchive: register.histogram<{step: FrequencyStateArchiveStep}>({
        name: "lodestar_process_finalized_checkpoint_frequency_state_archive_seconds",
        help: "Histogram of FrequencyStateArchive duration by step",
        buckets: [0.1, 0.5, 1, 2, 4, 8],
        labelNames: ["step"],
      }),
    },

    regenFnCallTotal: register.gauge<{entrypoint: RegenFnName; caller: RegenCaller}>({
      name: "lodestar_regen_fn_call_total",
      help: "Total number of calls for regen functions",
      labelNames: ["entrypoint", "caller"],
    }),
    regenFnQueuedTotal: register.gauge<{entrypoint: RegenFnName; caller: RegenCaller}>({
      name: "lodestar_regen_fn_queued_total",
      help: "Total number of calls queued for regen functions",
      labelNames: ["entrypoint", "caller"],
    }),
    regenFnCallDuration: register.histogram<{entrypoint: RegenFnName; caller: RegenCaller}>({
      name: "lodestar_regen_fn_call_duration",
      help: "regen function duration",
      labelNames: ["entrypoint", "caller"],
      buckets: [0.1, 1, 10, 100],
    }),
    regenFnTotalErrors: register.gauge<{entrypoint: RegenFnName; caller: RegenCaller}>({
      name: "lodestar_regen_fn_errors_total",
      help: "regen function total errors",
      labelNames: ["entrypoint", "caller"],
    }),
    regenFnAddPubkeyTime: register.histogram({
      name: "lodestar_regen_fn_add_pubkey_time_seconds",
      help: "Historgram of time spent on adding pubkeys to all state cache items in seconds",
      buckets: [0.01, 0.1, 0.5, 1, 2, 5],
    }),
    regenFnDeletePubkeyTime: register.histogram({
      name: "lodestar_regen_fn_delete_pubkey_time_seconds",
      help: "Histrogram of time spent on deleting pubkeys from all state cache items in seconds",
      buckets: [0.01, 0.1, 0.5, 1],
    }),
    regenFnNumStatesUpdated: register.histogram({
      name: "lodestar_regen_state_cache_state_updated_count",
      help: "Histogram of number of state cache items updated every time removing pubkeys from unfinalized cache",
      buckets: [1, 2, 5, 10, 50, 250],
    }),
    unhandledPromiseRejections: register.gauge({
      name: "lodestar_unhandled_promise_rejections_total",
      help: "UnhandledPromiseRejection total count",
    }),
    stateSerializeDuration: register.histogram<{source: AllocSource}>({
      name: "lodestar_state_serialize_seconds",
      help: "Histogram of time to serialize state",
      labelNames: ["source"],
      buckets: [0.1, 0.5, 1, 2, 3, 4],
    }),

    // regen.getState metrics
    regenGetState: {
      blockCount: register.histogram<{caller: RegenCaller}>({
        name: "lodestar_regen_get_state_block_count",
        help: "Block count in regen.getState",
        labelNames: ["caller"],
        buckets: [4, 8, 16, 32, 64],
      }),
      getSeedState: register.histogram<{caller: RegenCaller}>({
        name: "lodestar_regen_get_state_get_seed_state_seconds",
        help: "Duration of get seed state in regen.getState",
        labelNames: ["caller"],
        buckets: [0.1, 0.5, 1, 2, 3, 4],
      }),
      loadBlocks: register.histogram<{caller: RegenCaller}>({
        name: "lodestar_regen_get_state_load_blocks_seconds",
        help: "Duration of load blocks in regen.getState",
        labelNames: ["caller"],
        buckets: [0.1, 0.5, 1, 2, 3, 4],
      }),
      stateTransition: register.histogram<{caller: RegenCaller}>({
        name: "lodestar_regen_get_state_state_transition_seconds",
        help: "Duration of state transition in regen.getState",
        labelNames: ["caller"],
        buckets: [0.1, 0.5, 1, 2, 3, 4],
      }),
    },

    // Precompute next epoch transition
    precomputeNextEpochTransition: {
      count: register.counter<{result: string}>({
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
      duration: register.histogram({
        name: "lodestar_precompute_next_epoch_transition_duration_seconds",
        help: "Duration of precomputeNextEpochTransition, including epoch transition and hashTreeRoot",
        buckets: [0.2, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 10],
      }),
    },

    // reprocess attestations
    reprocessApiAttestations: {
      total: register.gauge({
        name: "lodestar_reprocess_attestations_total",
        help: "Total number of attestations waiting to reprocess",
      }),
      resolve: register.gauge({
        name: "lodestar_reprocess_attestations_resolve_total",
        help: "Total number of attestations are reprocessed",
      }),
      waitSecBeforeResolve: register.gauge({
        name: "lodestar_reprocess_attestations_wait_time_resolve_seconds",
        help: "Time to wait for unknown block in seconds",
      }),
      reject: register.gauge<{reason: ReprocessStatus}>({
        name: "lodestar_reprocess_attestations_reject_total",
        help: "Total number of attestations are rejected to reprocess",
        labelNames: ["reason"],
      }),
      waitSecBeforeReject: register.gauge<{reason: ReprocessStatus}>({
        name: "lodestar_reprocess_attestations_wait_time_reject_seconds",
        help: "Time to wait for unknown block before being rejected",
        labelNames: ["reason"],
      }),
    },

    // reprocess gossip attestations
    reprocessGossipAttestations: {
      total: register.gauge({
        name: "lodestar_reprocess_gossip_attestations_total",
        help: "Total number of gossip attestations waiting to reprocess",
      }),
      countPerSlot: register.gauge({
        name: "lodestar_reprocess_gossip_attestations_per_slot_total",
        help: "Total number of gossip attestations waiting to reprocess pet slot",
      }),
      resolve: register.gauge({
        name: "lodestar_reprocess_gossip_attestations_resolve_total",
        help: "Total number of gossip attestations are reprocessed",
      }),
      waitSecBeforeResolve: register.gauge({
        name: "lodestar_reprocess_gossip_attestations_wait_time_resolve_seconds",
        help: "Time to wait for unknown block in seconds",
      }),
      reject: register.gauge<{reason: ReprocessRejectReason}>({
        name: "lodestar_reprocess_gossip_attestations_reject_total",
        help: "Total number of attestations are rejected to reprocess",
        labelNames: ["reason"],
      }),
      waitSecBeforeReject: register.gauge<{reason: ReprocessRejectReason}>({
        name: "lodestar_reprocess_gossip_attestations_wait_time_reject_seconds",
        help: "Time to wait for unknown block before being rejected",
        labelNames: ["reason"],
      }),
    },

    lightclientServer: {
      onSyncAggregate: register.gauge<{event: string}>({
        name: "lodestar_lightclient_server_on_sync_aggregate_event_total",
        help: "Total number of relevant events onSyncAggregate fn",
        labelNames: ["event"],
      }),
      highestSlot: register.gauge<{item: string}>({
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
      staleLightClientUpdates: register.counter({
        name: "lodestar_lightclient_server_stale_updates_total",
        help: "Total number of stale light client updates that were not emitted",
      }),
    },

    executionEnginerHttpClient: {
      requestTime: register.histogram<{routeId: string}>({
        name: "lodestar_execution_engine_http_client_request_time_seconds",
        help: "ExecutionEngineHttp client - histogram or roundtrip request times",
        labelNames: ["routeId"],
        // Provide max resolution on problematic values around 1 second
        buckets: [0.1, 0.5, 1, 2, 5, 15],
      }),
      streamTime: register.histogram<{routeId: string}>({
        name: "lodestar_execution_engine_http_client_stream_time_seconds",
        help: "ExecutionEngineHttp client - streaming time by routeId",
        labelNames: ["routeId"],
        // Provide max resolution on problematic values around 1 second
        buckets: [0.1, 0.5, 1, 2, 5, 15],
      }),
      requestErrors: register.gauge<{routeId: string}>({
        name: "lodestar_execution_engine_http_client_request_errors_total",
        help: "ExecutionEngineHttp client - total count of request errors",
        labelNames: ["routeId"],
      }),
      retryCount: register.gauge<{routeId: string}>({
        name: "lodestar_execution_engine_http_client_request_retries_total",
        help: "ExecutionEngineHttp client - total count of request retries",
        labelNames: ["routeId"],
      }),
      requestUsedFallbackUrl: register.gauge<{routeId: string}>({
        name: "lodestar_execution_engine_http_client_request_used_fallback_url_total",
        help: "ExecutionEngineHttp client - total count of requests on fallback url(s)",
        labelNames: ["routeId"],
      }),
      activeRequests: register.gauge<{routeId: string}>({
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
      requestTime: register.histogram<{routeId: string}>({
        name: "lodestar_builder_http_client_request_time_seconds",
        help: "Histogram of builder http client request time by routeId",
        labelNames: ["routeId"],
        // Expected times are ~ 50-500ms, but in an overload NodeJS they can be greater
        buckets: [0.01, 0.1, 1, 5],
      }),
      streamTime: register.histogram<{routeId: string}>({
        name: "lodestar_builder_http_client_stream_time_seconds",
        help: "Builder api - streaming time by routeId",
        labelNames: ["routeId"],
        // Provide max resolution on problematic values around 1 second
        buckets: [0.1, 0.5, 1, 2, 5, 15],
      }),
      requestErrors: register.gauge<{routeId: string; baseUrl: string}>({
        name: "lodestar_builder_http_client_request_errors_total",
        help: "Total count of errors on builder http client requests by routeId",
        labelNames: ["routeId", "baseUrl"],
      }),
      requestToFallbacks: register.gauge<{routeId: string; baseUrl: string}>({
        name: "lodestar_builder_http_client_request_to_fallbacks_total",
        help: "Total count of requests to fallback URLs on builder http API by routeId",
        labelNames: ["routeId", "baseUrl"],
      }),

      urlsScore: register.gauge<{urlIndex: number; baseUrl: string}>({
        name: "lodestar_builder_http_client_urls_score",
        help: "Current score of builder http URLs by url index",
        labelNames: ["urlIndex", "baseUrl"],
      }),
    },

    db: {
      dbReadReq: register.gauge<{bucket: string}>({
        name: "lodestar_db_read_req_total",
        help: "Total count of db read requests, may read 0 or more items",
        labelNames: ["bucket"],
      }),
      dbReadItems: register.gauge<{bucket: string}>({
        name: "lodestar_db_read_items_total",
        help: "Total count of db read items, item = key | value | entry",
        labelNames: ["bucket"],
      }),
      dbWriteReq: register.gauge<{bucket: string}>({
        name: "lodestar_db_write_req_total",
        help: "Total count of db write requests, may write 0 or more items",
        labelNames: ["bucket"],
      }),
      dbWriteItems: register.gauge<{bucket: string}>({
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

    pruneHistory: {
      pruneCount: register.gauge({
        name: "lodestar_prune_history_prune_count_total",
        help: "Total count of prune operations",
      }),

      fetchKeys: register.histogram({
        name: "lodestar_prune_history_fetch_keys_time_seconds",
        help: "Time to fetch keys in seconds",
        buckets: [0.001, 0.01, 0.1, 0.3, 0.5, 1],
      }),

      pruneKeys: register.histogram({
        name: "lodestar_prune_history_prune_keys_time_seconds",
        help: "Time to prune keys in seconds",
        buckets: [0.001, 0.01, 0.1, 1],
      }),
    },
  };
}
