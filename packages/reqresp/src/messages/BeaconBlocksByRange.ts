import {allForks, phase0, ssz} from "@lodestar/types";
import {ContextBytesType, Encoding, ProtocolDefinitionGenerator} from "../types.js";
import {minutes} from "./utils.js";

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
    inboundRateLimits: {
      /**
       * Nodes uses these endpoint during the sync to fetch blocks.
       * If we restrict too much we can get into a situation where nodes can't sync from us.
       * Higher range may end-up in a DOS attack.
       * So we try to use optimistic values. We can always tune this later.
       */
      byPeer: {quota: 500, quotaTime: minutes(1)},
      total: {quota: 2000, quotaTime: minutes(1)},
      getRequestCount: (req) => req.count,
    },
  };
};
