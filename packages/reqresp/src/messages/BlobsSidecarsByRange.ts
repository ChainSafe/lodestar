import {eip4844, ssz} from "@lodestar/types";
import {ContextBytesType, Encoding, ProtocolDefinitionGenerator} from "../types.js";
import {blocksByRangeInboundRateLimit} from "./BeaconBlocksByRange.js";
import {seconds} from "./utils.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const BlobsSidecarsByRange: ProtocolDefinitionGenerator<
  eip4844.BlobsSidecarsByRangeRequest,
  eip4844.BlobsSidecar
> = (modules, handler) => {
  return {
    method: "blobs_sidecars_by_range",
    version: 1,
    encoding: Encoding.SSZ_SNAPPY,
    handler,
    requestType: () => ssz.eip4844.BlobsSidecarsByRangeRequest,
    // TODO: Make it fork compliant
    responseType: () => ssz.eip4844.BlobsSidecar,
    renderRequestBody: (req) => `${req.startSlot},${req.count}`,
    contextBytes: {
      type: ContextBytesType.ForkDigest,
      forkDigestContext: modules.config,
      forkFromResponse: (blobsSidecar) => modules.config.getForkName(blobsSidecar.beaconBlockSlot),
    },
    inboundRateLimits: {
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
    },
  };
};
