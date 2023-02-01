import {deneb, ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {ContextBytesType, Encoding, ProtocolDefinitionGenerator} from "../types.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const BeaconBlockAndBlobsSidecarByRoot: ProtocolDefinitionGenerator<
  deneb.BeaconBlockAndBlobsSidecarByRootRequest,
  deneb.SignedBeaconBlockAndBlobsSidecar
> = (modules, handler) => {
  return {
    method: "beacon_block_and_blobs_sidecar_by_root",
    version: 1,
    encoding: Encoding.SSZ_SNAPPY,
    handler,
    requestType: () => ssz.deneb.BeaconBlockAndBlobsSidecarByRootRequest,
    // TODO: Make it fork compliant
    responseType: () => ssz.deneb.SignedBeaconBlockAndBlobsSidecar,
    renderRequestBody: (req) => req.map((root) => toHex(root)).join(","),
    contextBytes: {
      type: ContextBytesType.ForkDigest,
      forkDigestContext: modules.config,
      forkFromResponse: ({beaconBlock}) => modules.config.getForkName(beaconBlock.message.slot),
    },
    inboundRateLimits: {
      // TODO DENEB: For now same value as BeaconBlocksByRoot https://github.com/sigp/lighthouse/blob/bf533c8e42cc73c35730e285c21df8add0195369/beacon_node/lighthouse_network/src/rpc/mod.rs#L118-L130
      byPeer: {quota: 128, quotaTimeMs: 10_000},
      getRequestCount: (req) => req.length,
    },
  };
};
