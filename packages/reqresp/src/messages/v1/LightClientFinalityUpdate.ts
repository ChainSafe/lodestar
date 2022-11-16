import {altair, ssz} from "@lodestar/types";
import {Encoding, Method, ProtocolDefinitionGenerator, Version} from "../../types.js";
import {getContextBytesLightclient} from "../utils.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const LightClientFinalityUpdate: ProtocolDefinitionGenerator<null, altair.LightClientFinalityUpdate> = (
  handler,
  modules
) => {
  return {
    method: Method.LightClientFinalityUpdate,
    version: Version.V1,
    encoding: Encoding.SSZ_SNAPPY,
    handler: async function* statusHandler(_context, req, peerId) {
      yield* handler(req, peerId);
    },
    requestType: () => null,
    responseType: () => ssz.altair.LightClientFinalityUpdate,
    contextBytes: getContextBytesLightclient((update) => modules.config.getForkName(update.signatureSlot), modules),
    isSingleResponse: true,
  };
};
