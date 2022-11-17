import {altair, ssz} from "@lodestar/types";
import {Encoding, Method, ProtocolDefinitionGenerator, Version} from "../../types.js";
import {getContextBytesLightclient, getHandlerRequiredErrorFor} from "../utils.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const LightClientOptimisticUpdate: ProtocolDefinitionGenerator<null, altair.LightClientOptimisticUpdate> = (
  modules,
  handler
) => {
  if (!handler) {
    throw getHandlerRequiredErrorFor(Method.LightClientOptimisticUpdate);
  }
  return {
    method: Method.LightClientOptimisticUpdate,
    version: Version.V1,
    encoding: Encoding.SSZ_SNAPPY,
    handler: async function* statusHandler(_context, req, peerId) {
      yield* handler(req, peerId);
    },
    requestType: () => null,
    responseType: () => ssz.altair.LightClientOptimisticUpdate,
    contextBytes: getContextBytesLightclient((update) => modules.config.getForkName(update.signatureSlot), modules),
    isSingleResponse: true,
  };
};
