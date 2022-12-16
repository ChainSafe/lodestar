import {altair, ssz} from "@lodestar/types";
import {Encoding, ProtocolDefinitionGenerator} from "../types.js";
import {getContextBytesLightclient} from "./utils.js";

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
      // Finality updates should not be requested more than once per epoch.
      // Allow 2 per slot and a very safe bound until there's more testing of real usage.
      byPeer: {quota: 2, quotaTimeMs: 12_000},
    },
  };
};
