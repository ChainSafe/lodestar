import {BeaconState} from "@chainsafe/lodestar-types/lib/allForks";
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
  anchorState?: BeaconState
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
      name: "lodestar_peers_by_direction",
      help: "number of peers, labeled by direction",
      labelNames: ["direction"],
    }),
    peerConnectedEvent: register.gauge<"direction">({
      name: "lodestar_peer_connected",
      help: "Number of peer:connected event, labeled by direction",
      labelNames: ["direction"],
    }),
    peerDisconnectedEvent: register.gauge<"direction">({
      name: "lodestar_peer_disconnected",
      help: "Number of peer:disconnected event, labeled by direction",
      labelNames: ["direction"],
    }),
    peerGoodbyeReceived: register.gauge<"reason">({
      name: "lodestar_peer_goodbye_received",
      help: "Number of goodbye received, labeled by reason",
      labelNames: ["reason"],
    }),
    peerGoodbyeSent: register.gauge<"reason">({
      name: "lodestar_peer_goodbye_sent",
      help: "Number of goodbye sent, labeled by reason",
      labelNames: ["reason"],
    }),
    peersTotalUniqueConnected: register.gauge({
      name: "lodestar_peers_total_unique_connected",
      help: "Total number of unique peers that have had a connection with",
    }),

    gossipMeshPeersByType: register.gauge<"gossipType">({
      name: "lodestar_gossip_mesh_peers_by_type",
      help: "Number of connected mesh peers per gossip type",
      labelNames: ["gossipType"],
    }),
    gossipMeshPeersByBeaconAttestationSubnet: register.gauge<"subnet">({
      name: "lodestar_gossip_mesh_peers_by_beacon_attestation_subnet",
      help: "Number of connected mesh peers per beacon attestation subnet",
      labelNames: ["subnet"],
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
      buckets: [0.01, 0.1, 0.5, 1, 5, 10],
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

    blsThreadPoolSuccessJobsSignatureSetsCount: register.gauge({
      name: "lodestar_bls_thread_pool_success_jobs_signature_sets_count",
      help: "Count of total verified signature sets",
    }),
    blsThreadPoolSuccessJobsWorkerTime: register.gauge<"workerId">({
      name: "lodestar_bls_thread_pool_success_time_seconds_sum",
      help: "Total time spent verifying signature sets measured on the worker",
      labelNames: ["workerId"],
    }),
    blsThreadPoolErrorJobsSignatureSetsCount: register.gauge({
      name: "lodestar_bls_thread_pool_error_jobs_signature_sets_count",
      help: "Count of total error-ed signature sets",
    }),
    blsThreadPoolJobWaitTime: register.histogram({
      name: "lodestar_bls_thread_pool_queue_job_wait_time_seconds",
      help: "Time from job added to the queue to starting the job in seconds",
      buckets: [0.1, 1, 10],
    }),
    blsThreadPoolQueueLength: register.gauge({
      name: "lodestar_bls_thread_pool_queue_length",
      help: "Count of total block processor queue length",
    }),
    blsThreadPoolTotalJobsGroupsStarted: register.gauge({
      name: "lodestar_bls_thread_pool_job_groups_started_total",
      help: "Count of total jobs groups started in bls thread pool, job groups include +1 jobs",
    }),
    blsThreadPoolTotalJobsStarted: register.gauge({
      name: "lodestar_bls_thread_pool_jobs_started_total",
      help: "Count of total jobs started in bls thread pool, jobs include +1 signature sets",
    }),

    // Sync

    syncChainsStarted: register.gauge<"syncType">({
      name: "lodestar_sync_chains_started",
      help: "Total number of sync chains started events, labeled by syncType",
      labelNames: ["syncType"],
    }),
    syncStatus: register.gauge({
      name: "lodestar_sync_status",
      help: "Range sync status: [Stalled, SyncingFinalized, SyncingHead, Synced]",
    }),
  };
}
