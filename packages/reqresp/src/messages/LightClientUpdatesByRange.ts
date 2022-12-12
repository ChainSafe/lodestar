import {altair, ssz} from "@lodestar/types";
import {Encoding, ProtocolDefinitionGenerator} from "../types.js";
import {getContextBytesLightclient, seconds} from "./utils.js";

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
       * A peer can send requests upto `MAX_REQUEST_LIGHT_CLIENT_UPDATES` which default is `128`.
       * A client can send fewer requests with higher count or more requests with lesser count.
       *
       * 10 seconds is chosen to be fair but can be updated in future.
       *
       * For total we multiply with `10` to have lower peer count on light client.
       *
       */
      byPeer: {quota: 128, quotaTime: seconds(10)},
      total: {quota: 1280, quotaTime: seconds(10)},
      getRequestCount: (req) => req.count,
    },
  };
};
