import { ProducedBlockSource } from "@lodestar/types";
import { BlockSelectionResult } from "../../api/impl/validator/index.js";
import { RegistryMetricCreator } from "../utils/registryMetricCreator.js";

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

    beaconMetricsSpecsInterop: {
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
      // duplicates reorg from metrics.forkChoice
      reorgEventsTotal: register.gauge({
        name: "beacon_reorgs_total",
        help: "number of chain reorganizations",
      }),
      processedDepositsTotal: register.gauge({
        name: "beacon_processed_deposits_total",
        help: "number of total deposits included on chain",
      }),
    },
    // From https://github.com/ethereum/beacon-metrics/blob/master/metrics.md
    // Additional Metrics
    // TODO: Implement

    // currentValidators: register.gauge<{status: string}>({
    //   name: "beacon_current_validators",
    //   labelNames: ["status"],
    //   help: "number of validators in current epoch",
    // }),

    // Non-spec'ed

    // validator api
    api: {
      blockProductionTime: register.histogram<{ source: ProducedBlockSource }>({
        name: "beacon_block_production_seconds",
        help: "Full runtime of block production",
        buckets: [0.1, 1, 2, 4, 10],
        labelNames: ["source"],
      }),
      blockProductionRequests: register.gauge<{ source: ProducedBlockSource }>({
        name: "beacon_block_production_requests_total",
        help: "Count of all block production requests",
        labelNames: ["source"],
      }),
      blockProductionSuccess: register.gauge<{ source: ProducedBlockSource }>({
        name: "beacon_block_production_successes_total",
        help: "Count of blocks successfully produced",
        labelNames: ["source"],
      }),
      // not used on the dashboard
      blockProductionSelectionResults: register.gauge<BlockSelectionResult>({
        name: "beacon_block_production_selection_results_total",
        help: "Count of all block production selection results",
        labelNames: ["source", "reason"],
      }),
      // not used on the dashboard
      blockProductionNumAggregated: register.histogram<{ source: ProducedBlockSource }>({
        name: "beacon_block_production_num_aggregated_total",
        help: "Count of all aggregated attestations in our produced block",
        buckets: [32, 64, 96, 128],
        labelNames: ["source"],
      }),
      // not used on the dashboard
      blockProductionExecutionPayloadValue: register.histogram<{ source: ProducedBlockSource }>({
        name: "beacon_block_production_execution_payload_value",
        help: "Execution payload value denominated in ETH of produced blocks",
        buckets: [0.001, 0.005, 0.01, 0.03, 0.05, 0.07, 0.1, 0.3, 0.5, 1],
        labelNames: ["source"],
      }),
    },

    // network
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
  };
}
