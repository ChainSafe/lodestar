import {allForks, phase0, ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {ContextBytesType, Encoding, ProtocolDefinitionGenerator} from "../types.js";
import {minutes} from "./utils.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const BeaconBlocksByRootV2: ProtocolDefinitionGenerator<
  phase0.BeaconBlocksByRootRequest,
  allForks.SignedBeaconBlock
> = (modules, handler) => {
  return {
    method: "beacon_blocks_by_root",
    version: 2,
    encoding: Encoding.SSZ_SNAPPY,
    handler,
    requestType: () => ssz.phase0.BeaconBlocksByRootRequest,
    responseType: (forkName) => ssz[forkName].SignedBeaconBlock,
    renderRequestBody: (req) => req.map((root) => toHex(root)).join(","),
    contextBytes: {
      type: ContextBytesType.ForkDigest,
      forkDigestContext: modules.config,
      forkFromResponse: (block) => modules.config.getForkName(block.message.slot),
    },
    inboundRateLimits: {
      /**
       * Nodes uses these endpoint to fetch certain blocks to initiate sync process.
       * Higher range may end-up in a DOS attack.
       * So we try to use optimistic values. We can always tune this later.
       */
      byPeer: {quota: 200, quotaTime: minutes(1)},
      total: {quota: 1000, quotaTime: minutes(1)},
    },
  };
};
