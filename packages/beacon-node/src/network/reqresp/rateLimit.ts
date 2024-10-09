import {
  MAX_REQUEST_BLOCKS,
  MAX_REQUEST_LIGHT_CLIENT_UPDATES,
  MAX_BLOBS_PER_BLOCK,
  MAX_REQUEST_BLOB_SIDECARS,
} from "@lodestar/params";
import {InboundRateLimitQuota} from "@lodestar/reqresp";
import {ReqRespMethod, RequestBodyByMethod} from "./types.js";
import {requestSszTypeByMethod} from "./types.js";

export const rateLimitQuotas: Record<ReqRespMethod, InboundRateLimitQuota> = {
  [ReqRespMethod.Status]: {
    // Rationale: https://github.com/sigp/lighthouse/blob/bf533c8e42cc73c35730e285c21df8add0195369/beacon_node/lighthouse_network/src/rpc/mod.rs#L118-L130
    byPeer: {quota: 5, quotaTimeMs: 15_000},
  },
  [ReqRespMethod.Goodbye]: {
    // Rationale: https://github.com/sigp/lighthouse/blob/bf533c8e42cc73c35730e285c21df8add0195369/beacon_node/lighthouse_network/src/rpc/mod.rs#L118-L130
    byPeer: {quota: 1, quotaTimeMs: 10_000},
  },
  [ReqRespMethod.Ping]: {
    // Rationale: https://github.com/sigp/lighthouse/blob/bf533c8e42cc73c35730e285c21df8add0195369/beacon_node/lighthouse_network/src/rpc/mod.rs#L118-L130
    byPeer: {quota: 2, quotaTimeMs: 10_000},
  },
  [ReqRespMethod.Metadata]: {
    // Rationale: https://github.com/sigp/lighthouse/blob/bf533c8e42cc73c35730e285c21df8add0195369/beacon_node/lighthouse_network/src/rpc/mod.rs#L118-L130
    byPeer: {quota: 2, quotaTimeMs: 5_000},
  },
  // Do not matter
  [ReqRespMethod.BeaconBlocksByRange]: {
    // Rationale: https://github.com/sigp/lighthouse/blob/bf533c8e42cc73c35730e285c21df8add0195369/beacon_node/lighthouse_network/src/rpc/mod.rs#L118-L130
    byPeer: {quota: MAX_REQUEST_BLOCKS, quotaTimeMs: 10_000},
    getRequestCount: getRequestCountFn(ReqRespMethod.BeaconBlocksByRange, (req) => req.count),
  },
  [ReqRespMethod.BeaconBlocksByRoot]: {
    // Rationale: https://github.com/sigp/lighthouse/blob/bf533c8e42cc73c35730e285c21df8add0195369/beacon_node/lighthouse_network/src/rpc/mod.rs#L118-L130
    byPeer: {quota: 128, quotaTimeMs: 10_000},
    getRequestCount: getRequestCountFn(ReqRespMethod.BeaconBlocksByRoot, (req) => req.length),
  },
  [ReqRespMethod.BlobSidecarsByRange]: {
    // Rationale: MAX_REQUEST_BLOCKS_DENEB * MAX_BLOBS_PER_BLOCK
    byPeer: {quota: MAX_REQUEST_BLOB_SIDECARS, quotaTimeMs: 10_000},
    getRequestCount: getRequestCountFn(ReqRespMethod.BlobSidecarsByRange, (req) => req.count),
  },
  [ReqRespMethod.BlobSidecarsByRoot]: {
    // Rationale: quota of BeaconBlocksByRoot * MAX_BLOBS_PER_BLOCK
    byPeer: {quota: 128 * MAX_BLOBS_PER_BLOCK, quotaTimeMs: 10_000},
    getRequestCount: getRequestCountFn(ReqRespMethod.BlobSidecarsByRoot, (req) => req.length),
  },
  [ReqRespMethod.LightClientBootstrap]: {
    // As similar in the nature of `Status` protocol so we use the same rate limits.
    byPeer: {quota: 5, quotaTimeMs: 15_000},
  },
  [ReqRespMethod.LightClientUpdatesByRange]: {
    // Same rationale as for BeaconBlocksByRange
    byPeer: {quota: MAX_REQUEST_LIGHT_CLIENT_UPDATES, quotaTimeMs: 10_000},
    getRequestCount: getRequestCountFn(ReqRespMethod.LightClientUpdatesByRange, (req) => req.count),
  },
  [ReqRespMethod.LightClientFinalityUpdate]: {
    // Finality updates should not be requested more than once per epoch.
    // Allow 2 per slot and a very safe bound until there's more testing of real usage.
    byPeer: {quota: 2, quotaTimeMs: 12_000},
  },
  [ReqRespMethod.LightClientOptimisticUpdate]: {
    // Optimistic updates should not be requested more than once per slot.
    // Allow 2 per slot and a very safe bound until there's more testing of real usage.
    byPeer: {quota: 2, quotaTimeMs: 12_000},
  },
};

// Helper to produce a getRequestCount function
function getRequestCountFn<T extends ReqRespMethod>(
  method: T,
  fn: (req: RequestBodyByMethod[T]) => number
): (reqData: Uint8Array) => number {
  const type = requestSszTypeByMethod[method];
  return (reqData: Uint8Array) => {
    try {
      return (type && fn(type.deserialize(reqData))) ?? 1;
    } catch (_e) {
      return 1;
    }
  };
}
