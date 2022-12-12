import {allForks, phase0, ssz} from "@lodestar/types";
import {ContextBytesType, Encoding, InboundRateLimitQuota, ProtocolDefinitionGenerator} from "../types.js";
import {seconds} from "./utils.js";

export const blocksByRangeInboundRateLimit: InboundRateLimitQuota<phase0.BeaconBlocksByRangeRequest> = {
  /**
   * One peer can request maximum blocks upto `MAX_REQUEST_BLOCKS` which is default to `1024`.
   * This limit can be consumed by peer in 10 seconds. Allowing him to send multiple requests
   * with lower limits or less requests with higher limit.
   *
   * 10 seconds is chosen to be fair but can be updated in future.
   *
   * For total we multiply with `defaultNetworkOptions.maxPeers`.
   */
  byPeer: {quota: 1024, quotaTime: seconds(10)},
  total: {quota: 56320, quotaTime: seconds(10)},
  getRequestCount: (req) => req.count,
};

// eslint-disable-next-line @typescript-eslint/naming-convention
export const BeaconBlocksByRange: ProtocolDefinitionGenerator<
  phase0.BeaconBlocksByRangeRequest,
  allForks.SignedBeaconBlock
> = (_modules, handler) => {
  return {
    method: "beacon_blocks_by_range",
    version: 1,
    encoding: Encoding.SSZ_SNAPPY,
    handler,
    requestType: () => ssz.phase0.BeaconBlocksByRangeRequest,
    responseType: (forkName) => ssz[forkName].SignedBeaconBlock,
    renderRequestBody: (req) => `${req.startSlot},${req.step},${req.count}`,
    contextBytes: {type: ContextBytesType.Empty},
    inboundRateLimits: blocksByRangeInboundRateLimit,
  };
};
