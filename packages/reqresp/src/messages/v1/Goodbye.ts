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
export const Goodbye: ProtocolDefinitionGenerator<phase0.Goodbye, phase0.Goodbye> = (_handler) => {
  return {
    method: Method.Status,
    version: Version.V1,
    encoding: Encoding.SSZ_SNAPPY,
    handler: async function* goodbyeHandler(context, req, peerId) {
      context.eventHandlers.onIncomingRequestBody({method: Method.Goodbye, body: req}, peerId);

      yield {type: EncodedPayloadType.ssz, data: context.modules.metadataController.seqNumber};
    },
    requestType: () => ssz.phase0.Goodbye,
    responseType: () => ssz.phase0.Goodbye,
    renderRequestBody: (req) => req.toString(10),
    contextBytes: {type: ContextBytesType.Empty},
    isSingleResponse: true,
  };
};
