import {allForks, phase0, ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {RespStatus} from "../../interface.js";
import {ResponseError} from "../../response/errors.js";
import {ContextBytesType, Encoding, Method, ProtocolDefinitionGenerator, Version} from "../../types.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const BeaconBlocksByRootV2: ProtocolDefinitionGenerator<
  phase0.BeaconBlocksByRootRequest,
  allForks.SignedBeaconBlock
> = (handler, modules) => {
  return {
    method: Method.BeaconBlocksByRoot,
    version: Version.V2,
    encoding: Encoding.SSZ_SNAPPY,
    handler: async function* beaconBlocksByRootV2Handler(context, req, peerId) {
      if (!context.modules.inboundRateLimiter.allowBlockByRequest(peerId, req.length)) {
        throw new ResponseError(RespStatus.RATE_LIMITED, "rate limit");
      }

      yield* handler(req, peerId);
    },
    requestType: () => ssz.phase0.BeaconBlocksByRootRequest,
    responseType: (forkName) => ssz[forkName].SignedBeaconBlock,
    renderRequestBody: (req) => req.map((root) => toHex(root)).join(","),
    contextBytes: {
      type: ContextBytesType.ForkDigest,
      forkDigestContext: modules.config,
      forkFromResponse: (block) => modules.config.getForkName(block.message.slot),
    },
    isSingleResponse: false,
  };
};
