import {allForks, phase0, ssz} from "@lodestar/types";
import {RespStatus} from "../../interface.js";
import {ResponseError} from "../../response/errors.js";
import {ContextBytesType, Encoding, Method, ProtocolDefinitionGenerator, Version} from "../../types.js";
import {getHandlerRequiredErrorFor} from "../utils.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const BeaconBlocksByRange: ProtocolDefinitionGenerator<
  phase0.BeaconBlocksByRangeRequest,
  allForks.SignedBeaconBlock
> = (_modules, handler) => {
  if (!handler) {
    throw getHandlerRequiredErrorFor(Method.BeaconBlocksByRange);
  }

  return {
    method: Method.BeaconBlocksByRange,
    version: Version.V1,
    encoding: Encoding.SSZ_SNAPPY,
    handler: async function* beaconBlocksByRangeHandler(context, req, peerId) {
      if (!context.modules.inboundRateLimiter.allowBlockByRequest(peerId, req.count)) {
        throw new ResponseError(RespStatus.RATE_LIMITED, "rate limit");
      }

      yield* handler(req, peerId);
    },
    requestType: () => ssz.phase0.BeaconBlocksByRangeRequest,
    responseType: (forkName) => ssz[forkName].SignedBeaconBlock,
    renderRequestBody: (req) => `${req.startSlot},${req.step},${req.count}`,
    contextBytes: {type: ContextBytesType.Empty},
    isSingleResponse: false,
  };
};
