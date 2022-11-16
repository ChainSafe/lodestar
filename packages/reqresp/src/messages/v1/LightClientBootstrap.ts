import {altair, Root, ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {Encoding, Method, ProtocolDefinitionGenerator, Version} from "../../types.js";
import {getContextBytesLightclient} from "../utils.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const LightClientBootstrap: ProtocolDefinitionGenerator<Root, altair.LightClientBootstrap> = (
  handler,
  modules
) => {
  return {
    method: Method.LightClientBootstrap,
    version: Version.V1,
    encoding: Encoding.SSZ_SNAPPY,
    handler: async function* lightClientBootstrapHandler(context, req, peerId) {
      yield* handler(req, peerId);
    },
    requestType: () => ssz.Root,
    responseType: () => ssz.altair.LightClientBootstrap,
    renderRequestBody: (req) => toHex(req),
    contextBytes: getContextBytesLightclient((bootstrap) => modules.config.getForkName(bootstrap.header.slot), modules),
    isSingleResponse: true,
  };
};
