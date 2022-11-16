import {phase0, ssz} from "@lodestar/types";
import {
  ContextBytesType,
  EncodedPayloadType,
  Encoding,
  Method,
  ProtocolDefinitionGenerator,
  Version,
} from "../../types.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const Ping: ProtocolDefinitionGenerator<phase0.Ping, phase0.Ping> = (_handler, modules) => {
  return {
    method: Method.Status,
    version: Version.V1,
    encoding: Encoding.SSZ_SNAPPY,
    handler: async function* pingHandler(context, req, peerId) {
      context.eventsHandlers.onIncomingRequestBody(context.modules, {method: Method.Ping, body: req}, peerId);

      yield {type: EncodedPayloadType.ssz, data: modules.metadata.seqNumber};
    },
    requestType: () => ssz.phase0.Ping,
    responseType: () => ssz.phase0.Ping,
    renderRequestBody: (req) => req.toString(10),
    contextBytes: {type: ContextBytesType.Empty},
    isSingleResponse: true,
  };
};
