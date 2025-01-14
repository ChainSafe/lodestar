import {UpdateHeadOpt} from "@lodestar/fork-choice";
import {NotReorgedReason} from "@lodestar/fork-choice/lib/forkChoice/interface.js";
import {ProducedBlockSource} from "@lodestar/types";
import {
  BlockSelectionResult,
  BuilderBlockSelectionReason,
  EngineBlockSelectionReason,
} from "../../api/impl/validator/index.js";
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

    // Non-spec'ed

    forkChoice: {
      findHead: register.histogram<{caller: string}>({
        name: "beacon_fork_choice_find_head_seconds",
        help: "Time taken to find head in seconds",
        buckets: [0.1, 1, 10],
        labelNames: ["caller"],
      }),
      requests: register.gauge({
        name: "beacon_fork_choice_requests_total",
        help: "Count of occasions where fork choice has tried to find a head",
      }),
      errors: register.gauge<{entrypoint: UpdateHeadOpt}>({
        name: "beacon_fork_choice_errors_total",
        help: "Count of occasions where fork choice has returned an error when trying to find a head",
        labelNames: ["entrypoint"],
      }),
      changedHead: register.gauge({
        name: "beacon_fork_choice_changed_head_total",
        help: "Count of occasions fork choice has found a new head",
      }),
      reorg: register.gauge({
        name: "beacon_fork_choice_reorg_total",
        help: "Count of occasions fork choice has switched to a different chain",
      }),
      reorgDistance: register.histogram({
        name: "beacon_fork_choice_reorg_distance",
        help: "Histogram of re-org distance",
        // We need high resolution in the low range, since re-orgs are a rare but critical event.
        // Add buckets up to 100 to capture high depth re-orgs. Above 100 things are going really bad.
        buckets: [1, 2, 3, 5, 7, 10, 20, 30, 50, 100],
      }),
      votes: register.gauge({
        name: "beacon_fork_choice_votes_count",
        help: "Current count of votes in fork choice data structures",
      }),
      queuedAttestations: register.gauge({
        name: "beacon_fork_choice_queued_attestations_count",
        help: "Count of queued_attestations in fork choice per slot",
      }),
      validatedAttestationDatas: register.gauge({
        name: "beacon_fork_choice_validated_attestation_datas_count",
        help: "Current count of validatedAttestationDatas in fork choice data structures",
      }),
      balancesLength: register.gauge({
        name: "beacon_fork_choice_balances_length",
        help: "Current length of balances in fork choice data structures",
      }),
      nodes: register.gauge({
        name: "beacon_fork_choice_nodes_count",
        help: "Current count of nodes in fork choice data structures",
      }),
      indices: register.gauge({
        name: "beacon_fork_choice_indices_count",
        help: "Current count of indices in fork choice data structures",
      }),
      notReorgedReason: register.gauge<{reason: NotReorgedReason}>({
        name: "beacon_fork_choice_not_reorged_reason_total",
        help: "Reason why the current head is not re-orged out",
        labelNames: ["reason"],
      }),
    },

    parentBlockDistance: register.histogram({
      name: "beacon_imported_block_parent_distance",
      help: "Histogram of distance to parent block of valid imported blocks",
      buckets: [1, 2, 3, 5, 7, 10, 20, 30, 50, 100],
    }),

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
      buckets: [32, 64, 96, 128],
      labelNames: ["source"],
    }),
    blockProductionExecutionPayloadValue: register.histogram<{source: ProducedBlockSource}>({
      name: "beacon_block_production_execution_payload_value",
      help: "Execution payload value denominated in ETH of produced blocks",
      buckets: [0.001, 0.005, 0.01, 0.03, 0.05, 0.07, 0.1, 0.3, 0.5, 1],
      labelNames: ["source"],
    }),

    blockProductionCaches: {
      producedBlockRoot: register.gauge({
        name: "beacon_blockroot_produced_cache_total",
        help: "Count of cached produced block roots",
      }),
      producedBlindedBlockRoot: register.gauge({
        name: "beacon_blinded_blockroot_produced_cache_total",
        help: "Count of cached produced blinded block roots",
      }),
      producedContentsCache: register.gauge({
        name: "beacon_contents_produced_cache_total",
        help: "Count of cached produced blob contents",
      }),
    },

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

    blockInputFetchStats: {
      // of already available blocks which didn't have to go through blobs pull
      totalDataAvailableBlockInputs: register.gauge({
        name: "beacon_blockinputs_already_available_total",
        help: "Total number of block inputs whose blobs were already available",
      }),
      totalDataAvailableBlockInputBlobs: register.gauge({
        name: "beacon_blockinput_blobs_already_available_total",
        help: "Total number of block input blobs that of already available blocks",
      }),

      // of those which need to be fetched
      dataPromiseBlobsAlreadyAvailable: register.gauge({
        name: "beacon_datapromise_blockinput_blobs_already_available_total",
        help: "Count of blocks that were already available in blockinput cache via gossip",
      }),
      dataPromiseBlobsDelayedGossipAvailable: register.gauge({
        name: "beacon_datapromise_blockinput_blobs_delayed_gossip_available_total",
        help: "Count of blobs that became available delayed via gossip post block arrival",
      }),
      dataPromiseBlobsDeplayedGossipAvailableSavedGetBlobsCompute: register.gauge({
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
      dataPromiseBlobsEngineGetBlobsApiRequests: register.gauge({
        name: "beacon_datapromise_blockinput_blobs_queried_in_getblobs_api_total",
        help: "Total number of blobs requested to the getblobs api",
      }),
      dataPromiseBlobsEngineGetBlobsApiNotNull: register.gauge({
        name: "beacon_datapromise_blockinput_blobs_responded_nonnull_in_getblobs_api_total",
        help: "Count of successful engine API responses that were not null",
      }),
      dataPromiseBlobsEngineGetBlobsApiNull: register.gauge({
        name: "beacon_datapromise_blockinput_blobs_responded_null_in_getblobs_api_total",
        help: "Count of engine API responses that were null",
      }),
      dataPromiseBlobsEngineApiGetBlobsErroredNull: register.gauge({
        name: "beacon_datapromise_blockinput_blobs_errored_as_null_in_getblobs_api_total",
        help: "Number of responses marked null due to errors in getblobs api",
      }),
      dataPromiseBlobsEngineApiGetBlobsUseful: register.gauge({
        name: "beacon_datapromise_blockinput_getblobs_api_nonnull_responses_used_total",
        help: "Count of successful non null engine API responses that were found useful",
      }),
      dataPromiseBlobsFinallyQueriedFromNetwork: register.gauge({
        name: "beacon_datapromise_blockinput_blobs_finally_queried_from_network_total",
        help: "Number of blob requests finally sent to the network",
      }),
      dataPromiseBlobsFinallyAvailableFromNetwork: register.gauge({
        name: "beacon_datapromise_blockinput_blobs_finally_resolved_from_network_total",
        help: "Number of blobs successfully fetched from the network",
      }),

      totalDataPromiseBlockInputsAvailableUsingGetBlobs: register.gauge({
        name: "beacon_datapromise_blockinputs_available_using_getblobs_total",
        help: "Count of block inputs that became available using non-null get blobs requests",
      }),
      totalDataPromiseBlockInputsTried: register.gauge({
        name: "beacon_datapromise_blockinputs_tried_for_blobs_pull_total",
        help: "Total number of block inputs that were tried to resolve",
      }),
      totalDataPromiseBlockInputsResolvedAvailable: register.gauge({
        name: "beacon_datapromise_blockinputs_available_post_blobs_pull_total",
        help: "Total number of block inputs that were successfully resolved as available on blobs pull",
      }),

      // retry counts
      totalDataPromiseBlockInputsReTried: register.gauge({
        name: "beacon_datapromise_blockinputs_retried_for_blobs_pull_total",
        help: "Total number of block inputs that were retried for blobs pull from network",
      }),
      dataPromiseBlobsRetriedFromNetwork: register.gauge({
        name: "beacon_datapromise_blockinput_blobs_retried_from_network_total",
        help: "Number of blob requests required from the network on retries",
      }),
      dataPromiseBlobsRetriedAvailableFromNetwork: register.gauge({
        name: "beacon_datapromise_blockinput_blobs_retried_and_resolved_from_network_total",
        help: "Number of blobs successfully fetched from the network on retries",
      }),
      totalDataPromiseBlockInputsRetriedAvailableFromNetwork: register.gauge({
        name: "beacon_datapromise_blockinputs_retried_and_resolved_from_network_total",
        help: "Number of blockinputs successfully resolved from the network on retries",
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
