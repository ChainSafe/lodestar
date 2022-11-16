import {altair, ssz} from "@lodestar/types";
import {Encoding, Method, ProtocolDefinitionGenerator, Version} from "../../types.js";
import {getContextBytesLightclient} from "../utils.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const LightClientUpdatesByRange: ProtocolDefinitionGenerator<
  altair.LightClientUpdatesByRange,
  altair.LightClientUpdate
> = (handler, modules) => {
  return {
    method: Method.LightClientUpdatesByRange,
    version: Version.V1,
    encoding: Encoding.SSZ_SNAPPY,
    handler: async function* statusHandler(_context, req, peerId) {
      yield* handler(req, peerId);
    },
    requestType: () => ssz.altair.LightClientUpdatesByRange,
    responseType: () => ssz.altair.LightClientUpdate,
    renderRequestBody: (req) => `${req.startPeriod},${req.count}`,
    contextBytes: getContextBytesLightclient((update) => modules.config.getForkName(update.signatureSlot), modules),
    isSingleResponse: true,
  };
};
