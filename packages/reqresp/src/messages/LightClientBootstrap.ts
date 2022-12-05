import {altair, Root, ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {Encoding, ProtocolDefinitionGenerator} from "../types.js";
import {getContextBytesLightclient, minutes} from "./utils.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const LightClientBootstrap: ProtocolDefinitionGenerator<Root, altair.LightClientBootstrap> = (
  modules,
  handler
) => {
  return {
    method: "light_client_bootstrap",
    version: 1,
    encoding: Encoding.SSZ_SNAPPY,
    handler,
    requestType: () => ssz.Root,
    responseType: () => ssz.altair.LightClientBootstrap,
    renderRequestBody: (req) => toHex(req),
    contextBytes: getContextBytesLightclient((bootstrap) => modules.config.getForkName(bootstrap.header.slot), modules),
    inboundRateLimits: {
      /**
       * The first message of the light client sync protocol.
       * Does not requires to have higher limit
       */
      byPeer: {quota: 2, quotaTime: minutes(1)},
      total: {quota: 50, quotaTime: minutes(1)},
    },
  };
};
