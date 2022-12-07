import {altair, ssz} from "@lodestar/types";
import {Encoding, ProtocolDefinitionGenerator} from "../types.js";
import {getContextBytesLightclient} from "./utils.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const LightClientOptimisticUpdate: ProtocolDefinitionGenerator<null, altair.LightClientOptimisticUpdate> = (
  modules,
  handler
) => {
  return {
    method: "light_client_optimistic_update",
    version: 1,
    encoding: Encoding.SSZ_SNAPPY,
    handler,
    requestType: () => null,
    responseType: () => ssz.altair.LightClientOptimisticUpdate,
    contextBytes: getContextBytesLightclient((update) => modules.config.getForkName(update.signatureSlot), modules),
  };
};
