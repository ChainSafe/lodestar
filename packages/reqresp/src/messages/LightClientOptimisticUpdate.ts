import {altair, ssz} from "@lodestar/types";
import {Encoding, ProtocolDefinitionGenerator} from "../types.js";
import {getContextBytesLightclient, seconds} from "./utils.js";

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
    inboundRateLimits: {
      /**
       * Optimistic updates can't be passed more frequently than once per slot.
       * So for one peer we allow more relaxed double rate limit.
       *
       * 12 seconds is chosen to be fair and relates to slot but can be updated in future.
       *
       * For total we multiply with `10` to have lower peer count on light client.
       */
      byPeer: {quota: 2, quotaTime: seconds(12)},
      total: {quota: 20, quotaTime: seconds(10)},
    },
  };
};
