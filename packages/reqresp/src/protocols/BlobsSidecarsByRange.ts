import {MAX_REQUEST_BLOCKS} from "@lodestar/params";
import {deneb, ssz} from "@lodestar/types";
import {ContextBytesType, Encoding, ProtocolDefinitionGenerator} from "../types.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const BlobsSidecarsByRange: ProtocolDefinitionGenerator<
  deneb.BlobsSidecarsByRangeRequest,
  deneb.BlobsSidecar
> = (modules, handler) => {
  return {
    method: "blobs_sidecars_by_range",
    version: 1,
    encoding: Encoding.SSZ_SNAPPY,
    handler,
    requestType: () => ssz.deneb.BlobsSidecarsByRangeRequest,
    // TODO: Make it fork compliant
    responseType: () => ssz.deneb.BlobsSidecar,
    renderRequestBody: (req) => `${req.startSlot},${req.count}`,
    contextBytes: {
      type: ContextBytesType.ForkDigest,
      forkDigestContext: modules.config,
      forkFromResponse: (blobsSidecar) => modules.config.getForkName(blobsSidecar.beaconBlockSlot),
    },
    inboundRateLimits: {
      // TODO DENEB: For now same value as BeaconBlocksByRange https://github.com/sigp/lighthouse/blob/bf533c8e42cc73c35730e285c21df8add0195369/beacon_node/lighthouse_network/src/rpc/mod.rs#L118-L130
      byPeer: {quota: MAX_REQUEST_BLOCKS, quotaTimeMs: 10_000},
      getRequestCount: (req) => req.count,
    },
  };
};
