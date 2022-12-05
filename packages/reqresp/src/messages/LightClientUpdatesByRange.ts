import {altair, ssz} from "@lodestar/types";
import {Encoding, ProtocolDefinitionGenerator} from "../types.js";
import {getContextBytesLightclient, minutes} from "./utils.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const LightClientUpdatesByRange: ProtocolDefinitionGenerator<
  altair.LightClientUpdatesByRange,
  altair.LightClientUpdate
> = (modules, handler) => {
  return {
    method: "light_client_updates_by_range",
    version: 1,
    encoding: Encoding.SSZ_SNAPPY,
    handler,
    requestType: () => ssz.altair.LightClientUpdatesByRange,
    responseType: () => ssz.altair.LightClientUpdate,
    renderRequestBody: (req) => `${req.startPeriod},${req.count}`,
    contextBytes: getContextBytesLightclient((update) => modules.config.getForkName(update.signatureSlot), modules),
    inboundRateLimits: {
      /**
       * To start with we will use same as blocksByRange
       * Can be optimized later on
       */
      byPeer: {quota: 500, quotaTime: minutes(1)},
      total: {quota: 2000, quotaTime: minutes(1)},
      getRequestCount: (req) => req.count,
    },
  };
};
