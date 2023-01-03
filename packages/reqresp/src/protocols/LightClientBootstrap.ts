import {altair, Root, ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {Encoding, ProtocolDefinitionGenerator} from "../types.js";
import {getContextBytesLightclient} from "./utils.js";

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
      // As similar in the nature of `Status` protocol so we use the same rate limits.
      byPeer: {quota: 5, quotaTimeMs: 15_000},
    },
  };
};
