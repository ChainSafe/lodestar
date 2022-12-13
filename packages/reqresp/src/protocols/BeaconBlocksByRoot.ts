import {allForks, phase0, ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {ContextBytesType, Encoding, ProtocolDefinitionGenerator, ProtocolDefinition} from "../types.js";

/* eslint-disable @typescript-eslint/naming-convention */
const BeaconBlocksByRootCommon: Pick<
  ProtocolDefinition<phase0.BeaconBlocksByRootRequest, allForks.SignedBeaconBlock>,
  "method" | "encoding" | "requestType" | "renderRequestBody" | "inboundRateLimits"
> = {
  method: "beacon_blocks_by_root",
  encoding: Encoding.SSZ_SNAPPY,
  requestType: () => ssz.phase0.BeaconBlocksByRootRequest,
  renderRequestBody: (req) => req.map((root) => toHex(root)).join(","),
  inboundRateLimits: {
    // Rationale: https://github.com/sigp/lighthouse/blob/bf533c8e42cc73c35730e285c21df8add0195369/beacon_node/lighthouse_network/src/rpc/mod.rs#L118-L130
    byPeer: {quota: 128, quotaTimeMs: 10_000},
    getRequestCount: (req) => req.length,
  },
};

export const BeaconBlocksByRoot: ProtocolDefinitionGenerator<
  phase0.BeaconBlocksByRootRequest,
  allForks.SignedBeaconBlock
> = (_modules, handler) => {
  return {
    ...BeaconBlocksByRootCommon,
    version: 1,
    handler,
    responseType: () => ssz.phase0.SignedBeaconBlock,
    contextBytes: {type: ContextBytesType.Empty},
  };
};

export const BeaconBlocksByRootV2: ProtocolDefinitionGenerator<
  phase0.BeaconBlocksByRootRequest,
  allForks.SignedBeaconBlock
> = (modules, handler) => {
  return {
    ...BeaconBlocksByRootCommon,
    version: 2,
    handler,
    responseType: (forkName) => ssz[forkName].SignedBeaconBlock,
    contextBytes: {
      type: ContextBytesType.ForkDigest,
      forkDigestContext: modules.config,
      forkFromResponse: (block) => modules.config.getForkName(block.message.slot),
    },
  };
};
