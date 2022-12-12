import {altair, ssz} from "@lodestar/types";
import {Encoding, ProtocolDefinitionGenerator} from "../types.js";
import {getContextBytesLightclient, seconds} from "./utils.js";

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
       * Finality updates can't be passed more frequently than once per epoch.
       * So for one peer we allow more relaxed double.
       *
       * 384 seconds is chosen to be fair and equivalent to 1 epoch. Can be updated in future.
       *
       * For total we multiply with `10` to have lower peer count on light client.
       */
      byPeer: {quota: 2, quotaTime: seconds(384)},
      total: {quota: 20, quotaTime: seconds(384)},
    },
  };
};
