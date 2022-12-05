import {altair, ssz} from "@lodestar/types";
import {Encoding, ProtocolDefinitionGenerator} from "../types.js";
import {getContextBytesLightclient, minutes} from "./utils.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const LightClientFinalityUpdate: ProtocolDefinitionGenerator<null, altair.LightClientFinalityUpdate> = (
  modules,
  handler
) => {
  return {
    method: "light_client_finality_update",
    version: 1,
    encoding: Encoding.SSZ_SNAPPY,
    handler,
    requestType: () => null,
    responseType: () => ssz.altair.LightClientFinalityUpdate,
    contextBytes: getContextBytesLightclient((update) => modules.config.getForkName(update.signatureSlot), modules),
    inboundRateLimits: {
      /**
       * Finality is updated less frequently than block, so we can afford to have a lower rate limit.
       */
      byPeer: {quota: 1, quotaTime: minutes(1)},
      total: {quota: 50, quotaTime: minutes(1)},
    },
  };
};
