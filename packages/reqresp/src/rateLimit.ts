import {MAX_REQUEST_BLOCKS, MAX_REQUEST_LIGHT_CLIENT_UPDATES} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {InboundRateLimitQuota, ReqRespMethod} from "./types.js";

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
    getRequestCount: (req) => ssz.phase0.BeaconBlocksByRangeRequest.deserialize(req).count,
  },
  [ReqRespMethod.BeaconBlocksByRoot]: {
    // Rationale: https://github.com/sigp/lighthouse/blob/bf533c8e42cc73c35730e285c21df8add0195369/beacon_node/lighthouse_network/src/rpc/mod.rs#L118-L130
    byPeer: {quota: 128, quotaTimeMs: 10_000},
    getRequestCount: (req) => ssz.phase0.BeaconBlocksByRootRequest.deserialize(req).length,
  },
  [ReqRespMethod.BlobsSidecarsByRange]: {
    // TODO DENEB: For now same value as BeaconBlocksByRange https://github.com/sigp/lighthouse/blob/bf533c8e42cc73c35730e285c21df8add0195369/beacon_node/lighthouse_network/src/rpc/mod.rs#L118-L130
    byPeer: {quota: MAX_REQUEST_BLOCKS, quotaTimeMs: 10_000},
    getRequestCount: (req) => ssz.deneb.BlobsSidecarsByRangeRequest.deserialize(req).count,
  },
  [ReqRespMethod.BeaconBlockAndBlobsSidecarByRoot]: {
    // TODO DENEB: For now same value as BeaconBlocksByRoot https://github.com/sigp/lighthouse/blob/bf533c8e42cc73c35730e285c21df8add0195369/beacon_node/lighthouse_network/src/rpc/mod.rs#L118-L130
    byPeer: {quota: 128, quotaTimeMs: 10_000},
    getRequestCount: (req) => ssz.deneb.BeaconBlockAndBlobsSidecarByRootRequest.deserialize(req).length,
  },
  [ReqRespMethod.LightClientBootstrap]: {
    // As similar in the nature of `Status` protocol so we use the same rate limits.
    byPeer: {quota: 5, quotaTimeMs: 15_000},
  },
  [ReqRespMethod.LightClientUpdatesByRange]: {
    // Same rationale as for BeaconBlocksByRange
    byPeer: {quota: MAX_REQUEST_LIGHT_CLIENT_UPDATES, quotaTimeMs: 10_000},
    getRequestCount: (req) => ssz.altair.LightClientUpdatesByRange.deserialize(req).count,
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
