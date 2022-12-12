import {allForks, phase0, ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {ContextBytesType, Encoding, ProtocolDefinitionGenerator} from "../types.js";
import {seconds} from "./utils.js";

export const blocksByRootInboundRateLimit = {
  /**
   * We keep it equivalent to `BeaconBlocksByRange` for now. As the fetching blocks by root
   * or fetching blocks by range is same in terms of network bandwidth and resource usage.
   *
   * 10 seconds is chosen to be fair but can be updated in future.
   *
   * For total we multiply with `defaultNetworkOptions.maxPeers`.
   */
  byPeer: {quota: 1024, quotaTime: seconds(10)},
  total: {quota: 56320, quotaTime: seconds(10)},
};

// eslint-disable-next-line @typescript-eslint/naming-convention
export const BeaconBlocksByRoot: ProtocolDefinitionGenerator<
  phase0.BeaconBlocksByRootRequest,
  allForks.SignedBeaconBlock
> = (_modules, handler) => {
  return {
    method: "beacon_blocks_by_root",
    version: 1,
    encoding: Encoding.SSZ_SNAPPY,
    handler,
    requestType: () => ssz.phase0.BeaconBlocksByRootRequest,
    responseType: (forkName) => ssz[forkName].SignedBeaconBlock,
    renderRequestBody: (req) => req.map((root) => toHex(root)).join(","),
    contextBytes: {type: ContextBytesType.Empty},
    inboundRateLimits: blocksByRootInboundRateLimit,
  };
};
