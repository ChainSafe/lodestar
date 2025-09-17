import {ProducedBlockSource} from "@lodestar/types";
import {BlockSelectionResult} from "../../api/impl/validator/index.js";
import {BlockProductionStep, PayloadPreparationType} from "../../chain/produceBlock/index.js";
import {RegistryMetricCreator} from "../utils/registryMetricCreator.js";

export type BeaconMetrics = ReturnType<typeof createBeaconMetrics>;

/**
 * Metrics from:
 * https://github.com/ethereum/beacon-metrics/ and
 * https://hackmd.io/D5FmoeFZScim_squBFl8oA
 */
export function createBeaconMetrics(register: RegistryMetricCreator) {
  return {
    // From https://github.com/ethereum/beacon-metrics/blob/master/metrics.md
    // Interop-metrics

    headSlot: register.gauge({
      name: "beacon_head_slot",
      help: "slot of the head block of the beacon chain",
    }),
    finalizedEpoch: register.gauge({
      name: "beacon_finalized_epoch",
      help: "current finalized epoch",
    }),
    currentJustifiedEpoch: register.gauge({
      name: "beacon_current_justified_epoch",
      help: "current justified epoch",
    }),
    previousJustifiedEpoch: register.gauge({
      name: "beacon_previous_justified_epoch",
      help: "previous justified epoch",
    }),
    currentActiveValidators: register.gauge({
      name: "beacon_current_active_validators",
      help: "number of active validators in current epoch",
    }),
    reorgEventsTotal: register.gauge({
      name: "beacon_reorgs_total",
      help: "number of chain reorganizations",
    }),
    processedDepositsTotal: register.gauge({
      name: "beacon_processed_deposits_total",
      help: "number of total deposits included on chain",
    }),

    // From https://github.com/ethereum/beacon-metrics/blob/master/metrics.md
    // Additional Metrics
    // TODO: Implement

    currentValidators: register.gauge<{status: string}>({
      name: "beacon_current_validators",
      labelNames: ["status"],
      help: "number of validators in current epoch",
    }),

    pendingDeposits: register.gauge({
      name: "beacon_pending_deposits",
      help: "Current number of pending deposits",
    }),

    pendingConsolidations: register.gauge({
      name: "beacon_pending_consolidations",
      help: "Current number of pending consolidations",
    }),

    pendingPartialWithdrawals: register.gauge({
      name: "beacon_pending_partial_withdrawals",
      help: "Current number of pending partial withdrawals",
    }),

    // Non-spec'ed

    parentBlockDistance: register.histogram({
      name: "beacon_imported_block_parent_distance",
      help: "Histogram of distance to parent block of valid imported blocks",
      buckets: [1, 2, 3, 5, 7, 10, 20, 30, 50, 100],
    }),

    // TODO: wrap to blockProduction
    blockProductionTime: register.histogram<{source: ProducedBlockSource}>({
      name: "beacon_block_production_seconds",
      help: "Full runtime of block production",
      buckets: [0.1, 1, 2, 4, 10],
      labelNames: ["source"],
    }),
    executionBlockProductionTimeSteps: register.histogram<{step: BlockProductionStep}>({
      name: "beacon_block_production_execution_steps_seconds",
      help: "Detailed steps runtime of execution block production",
      buckets: [0.01, 0.1, 0.2, 0.5, 1],
      labelNames: ["step"],
    }),
    builderBlockProductionTimeSteps: register.histogram<{step: BlockProductionStep}>({
      name: "beacon_block_production_builder_steps_seconds",
      help: "Detailed steps runtime of builder block production",
      buckets: [0.01, 0.1, 0.2, 0.5, 1],
      labelNames: ["step"],
    }),
    blockProductionRequests: register.gauge<{source: ProducedBlockSource}>({
      name: "beacon_block_production_requests_total",
      help: "Count of all block production requests",
      labelNames: ["source"],
    }),
    blockProductionSuccess: register.gauge<{source: ProducedBlockSource}>({
      name: "beacon_block_production_successes_total",
      help: "Count of blocks successfully produced",
      labelNames: ["source"],
    }),
    blockProductionSelectionResults: register.gauge<BlockSelectionResult>({
      name: "beacon_block_production_selection_results_total",
      help: "Count of all block production selection results",
      labelNames: ["source", "reason"],
    }),
    blockProductionNumAggregated: register.histogram<{source: ProducedBlockSource}>({
      name: "beacon_block_production_num_aggregated_total",
      help: "Count of all aggregated attestations in our produced block",
      buckets: [1, 2, 4, 6, 8],
      labelNames: ["source"],
    }),
    blockProductionConsensusBlockValue: register.histogram<{source: ProducedBlockSource}>({
      name: "beacon_block_production_consensus_block_value",
      help: "Consensus block value denominated in ETH of produced blocks",
      buckets: [0.001, 0.005, 0.01, 0.03, 0.05, 0.07, 0.1],
      labelNames: ["source"],
    }),
    blockProductionSlotDelta: register.gauge({
      name: "beacon_block_production_slot_delta",
      help: "Slot delta of produced slot compared to parent slot",
    }),
    blockProductionExecutionPayloadValue: register.histogram<{source: ProducedBlockSource}>({
      name: "beacon_block_production_execution_payload_value",
      help: "Execution payload value denominated in ETH of produced blocks",
      buckets: [0.001, 0.005, 0.01, 0.03, 0.05, 0.07, 0.1, 0.3, 0.5, 1],
      labelNames: ["source"],
    }),
    blockProductionCacheSize: register.gauge({
      name: "beacon_block_production_cache_size",
      help: "Count of cached produced results",
    }),

    blockPayload: {
      payloadAdvancePrepTime: register.histogram({
        name: "beacon_block_payload_prepare_time",
        help: "Time for preparing payload in advance",
        buckets: [0.1, 1, 3, 5, 10],
      }),
      payloadFetchedTime: register.histogram<{prepType: PayloadPreparationType}>({
        name: "beacon_block_payload_fetched_time",
        help: "Time to fetch the payload from EL",
        labelNames: ["prepType"],
        buckets: [0.1, 0.2, 0.3, 0.5, 0.7, 1, 2],
      }),
      emptyPayloads: register.gauge<{prepType: PayloadPreparationType}>({
        name: "beacon_block_payload_empty_total",
        help: "Count of payload with empty transactions",
        labelNames: ["prepType"],
      }),
      payloadFetchErrors: register.gauge({
        name: "beacon_block_payload_errors_total",
        help: "Count of errors while fetching payloads",
      }),
    },

    blobs: {
      getBlobsV1Requests: register.gauge({
        name: "beacon_get_blobs_v1_calls_total",
        help: "Number of getBlobsV1 requests that get made",
      }),
      getBlobsV1RequestedBlobCount: register.gauge({
        name: "beacon_get_blobs_v1_requested_blobs_count_total",
        help: "Number of versioned hashes that get sent in getBlobsV1 request",
      }),
      getBlobsV1Error: register.gauge({
        name: "beacon_get_blobs_v1_response_error_total",
        help: "Number of getBlobsV1 calls that errored ",
      }),
      getBlobsV1Miss: register.gauge({
        name: "beacon_get_blobs_v1_missing_blob_response_total",
        help: "Number of getBlobsV1 misses where a versioned hash returns a null",
      }),
      getBlobsV1Hit: register.gauge({
        name: "beacon_get_blobs_v1_blob_returned_response_total",
        help: "Number of getBlobsV1 hits where a versioned hash returns blob",
      }),
      getBlobsV1HitButArrivedWhileWaiting: register.gauge({
        name: "beacon_get_blobs_v1_blob_returned_but_arrived_during_response_total",
        help: "Number of getBlobsV1 hits where a versioned hash returns blob but the blob already arrived via gossip",
      }),
      getBlobsV1HitUseful: register.gauge({
        name: "beacon_get_blobs_v1_blob_useful_response_total",
        help: "Number of getBlobsV1 hits where a versioned hash returns blob and the blob is needed so call is useful",
      }),
    },

    blockInputFetchStats: {
      // of already available blocks which didn't have to go through blobs pull
      totalDataAvailableBlockInputBlobs: register.gauge({
        name: "beacon_blockinput_blobs_already_available_total",
        help: "Total number of block input blobs that of already available blocks",
      }),

      // blobs resolution stats
      dataPromiseBlobsAlreadyAvailable: register.gauge({
        name: "beacon_datapromise_blockinput_blobs_already_available_total",
        help: "Count of data promise blocks' blobs that were already available in blockinput cache via gossip",
      }),
      dataPromiseBlobsDelayedGossipAvailable: register.gauge({
        name: "beacon_datapromise_blockinput_blobs_delayed_gossip_available_total",
        help: "Count of data promise blocks' blobs that became available delayed via gossip post block arrival",
      }),
      dataPromiseBlobsDelayedGossipAvailableSavedGetBlobsCompute: register.gauge({
        name: "beacon_datapromise_blockinput_blobs_delayed_gossip_saved_computation_total",
        help: "Count of late available blobs that saved blob sidecar computation from getblobs",
      }),
      dataPromiseBlobsFoundInGetBlobsCacheNotNull: register.gauge({
        name: "beacon_datapromise_blockinput_blobs_found_nonnull_in_getblobs_cache_total",
        help: "Count of blobs that were found not null in getblobs cache",
      }),
      dataPromiseBlobsFoundInGetBlobsCacheNull: register.gauge({
        name: "beacon_datapromise_blockinput_blobs_found_null_in_getblobs_cache_total",
        help: "Count of blobs that were found null in the getblobs cache",
      }),
      dataPromiseBlobsNotAvailableInGetBlobsCache: register.gauge({
        name: "beacon_datapromise_blockinput_blobs_notfound_in_getblobs_cache_total",
        help: "Count of blobs that were newly seen and hence in not getblobs cache",
      }),

      dataPromiseBlobsFinallyQueriedFromNetwork: register.gauge({
        name: "beacon_datapromise_blockinput_blobs_finally_queried_from_network_total",
        help: "Number of blob requests finally sent to the network",
      }),
      dataPromiseBlobsFinallyAvailableFromNetwork: register.gauge({
        name: "beacon_datapromise_blockinput_blobs_finally_resolved_from_network_total",
        help: "Number of blobs successfully fetched from the network",
      }),
      dataPromiseBlobsRetriedFromNetwork: register.gauge({
        name: "beacon_datapromise_blockinput_blobs_retried_from_network_total",
        help: "Number of blob requests required from the network on retries",
      }),
      dataPromiseBlobsRetriedAvailableFromNetwork: register.gauge({
        name: "beacon_datapromise_blockinput_blobs_retried_and_resolved_from_network_total",
        help: "Number of blobs successfully fetched from the network on retries",
      }),

      // blockinput resolution stats
      totalDataAvailableBlockInputs: register.gauge({
        name: "beacon_blockinputs_already_available_total",
        help: "Total number of block inputs whose blobs were already available",
      }),
      totalDataPromiseBlockInputsAvailableUsingGetBlobs: register.gauge({
        name: "beacon_datapromise_blockinputs_available_using_getblobs_total",
        help: "Count of block inputs that became available using non-null get blobs requests",
      }),
      totalDataPromiseBlockInputsAvailableFromGetBlobs: register.gauge({
        name: "beacon_datapromise_blockinputs_available_from_getblobs_total",
        help: "Count of block inputs that became available from non-null get blobs requests",
      }),
      totalDataPromiseBlockInputsFinallyAvailableFromNetworkReqResp: register.gauge({
        name: "beacon_datapromise_blockinputs_finally_available_from_reqresp_total",
        help: "Count of block inputs that became available using the req/resp from network",
      }),
      totalDataPromiseBlockInputsTriedBlobsPull: register.gauge({
        name: "beacon_datapromise_blockinputs_tried_for_blobs_pull_total",
        help: "Total number of block inputs that were tried to resolve",
      }),
      totalDataPromiseBlockInputsTriedGetBlobs: register.gauge({
        name: "beacon_datapromise_blockinputs_tried_for_getblobs_pull_total",
        help: "Total number of block inputs that were tried to resolve",
      }),
      totalDataPromiseBlockInputsResolvedAvailable: register.gauge({
        name: "beacon_datapromise_blockinputs_available_post_blobs_pull_total",
        help: "Total number of block inputs that were successfully resolved as available on blobs pull",
      }),
      totalDataPromiseBlockInputsRetriedAvailableFromNetwork: register.gauge({
        name: "beacon_datapromise_blockinputs_retried_and_resolved_from_network_total",
        help: "Number of blockinputs successfully resolved from the network on retries",
      }),
      totalDataPromiseBlockInputsReTriedBlobsPull: register.gauge({
        name: "beacon_datapromise_blockinputs_retried_for_blobs_pull_total",
        help: "Total number of block inputs that were retried for blobs pull from network",
      }),

      // some caches stats
      getBlobsCacheSize: register.gauge({
        name: "getblob_cache_size",
        help: "getBlobs cache size",
      }),
      getBlobsCachePruned: register.gauge({
        name: "getblob_cache_pruned_total",
        help: "getblobs cache pruned count",
      }),
      dataPromiseBlockInputRetryTrackerCacheSize: register.gauge({
        name: "beacon_datapromise_blockinput_retry_tracker_cache_size",
        help: "datapromise retry tracker cache size",
      }),
      dataPromiseBlockInputRetryTrackerCachePruned: register.gauge({
        name: "beacon_datapromise_blockinput_retry_tracker_cache_pruned",
        help: "datapromise retry tracker cache pruned count",
      }),
    },

    // TODO(fulu): check if these and metrics in lodestar.ts for dataColumns should/can be combined or organized together
    peerDas: {
      dataColumnSidecarProcessingRequests: register.counter({
        name: "beacon_data_column_sidecar_processing_requests_total",
        help: "Number of data column sidecars submitted for processing",
      }),
      dataColumnSidecarProcessingSkip: register.counter({
        name: "beacon_data_column_sidecar_processing_skip_total",
        help: "Number of data column sidecars with processing skipped for gossip",
      }),
      dataColumnSidecarProcessingSuccesses: register.counter({
        name: "beacon_data_column_sidecar_processing_successes_total",
        help: "Number of data column sidecars verified for gossip",
      }),
      dataColumnSidecarGossipVerificationTime: register.histogram({
        name: "beacon_data_column_sidecar_gossip_verification_seconds",
        help: "Full runtime of data column sidecars gossip verification",
        buckets: [0.025, 0.05, 0.1, 0.5, 1, 2, 5],
      }),
      dataColumnSidecarComputationTime: register.histogram({
        name: "beacon_data_column_sidecar_computation_seconds",
        help: "Time taken to compute data column sidecars, including cells and inclusion proof",
        buckets: [0.1, 0.25, 0.5, 0.75, 1, 2, 5],
      }),
      dataColumnSidecarInclusionProofVerificationTime: register.histogram({
        name: "beacon_data_column_sidecar_inclusion_proof_verification_seconds",
        help: "Time taken to verify data_column sidecar inclusion proof",
        buckets: [0.002, 0.004, 0.006, 0.008, 0.01, 0.05, 1, 2],
      }),
      dataColumnSidecarKzgProofsVerificationTime: register.histogram({
        name: "beacon_data_column_sidecar_kzg_proofs_verification_seconds",
        help: "Time taken to verify data_column sidecar kzg proofs",
        buckets: [0.01, 0.02, 0.03, 0.04, 0.05, 0.1, 0.2, 0.5, 1],
      }),
      kzgVerificationDataColumnBatchTime: register.histogram({
        name: "beacon_kzg_verification_data_column_batch_seconds",
        help: "Runtime of batched data column kzg verification",
        buckets: [0.025, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 1, 2, 5],
      }),
      getBlobsV2PreAllocationTime: register.histogram({
        name: "beacon_engine_getBlobsV2_buffer_preallocation_duration_seconds",
        help: "Runtime for pre-allocating buffers to use during getBlobsV2 calls",
        buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 1],
      }),
      getBlobsV2Requests: register.counter({
        name: "beacon_engine_getBlobsV2_requests_total",
        help: "Total number of engine_getBlobsV2 requests sent",
      }),
      getBlobsV2Responses: register.counter({
        name: "beacon_engine_getBlobsV2_responses_total",
        help: "Total number of engine_getBlobsV2 successful responses received",
      }),
      getBlobsV2RequestDuration: register.histogram({
        name: "beacon_engine_getBlobsV2_request_duration_seconds",
        help: "Duration of engine_getBlobsV2 requests",
        buckets: [0.01, 0.05, 0.1, 0.5, 1, 2.5, 5, 7.5],
      }),
      targetCustodyGroupCount: register.gauge({
        name: "beacon_target_custody_group_count",
        help: "Total number of custody groups within a node",
      }),
      reconstructedColumns: register.counter({
        name: "beacon_data_availability_reconstructed_columns_total",
        help: "Total count of reconstructed columns",
      }),
      dataColumnsReconstructionTime: register.histogram({
        name: "beacon_data_availability_reconstruction_time_seconds",
        help: "Time taken to reconstruct columns",
        // this data comes from 20 blobs in `fusaka-devnet-1`, need to reevaluate in the future
        buckets: [0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 2, 5],
      }),
    },

    // Non-spec'ed
    clockSlot: register.gauge({
      name: "beacon_clock_slot",
      help: "Current clock slot",
    }),
    clockEpoch: register.gauge({
      name: "beacon_clock_epoch",
      help: "Current clock epoch",
    }),

    weakHeadDetected: register.gauge({
      name: "beacon_weak_head_detected_total",
      help: "Detected current head block is weak. May reorg it out when proposing next slot. See proposer boost reorg for more",
    }),
  };
}
