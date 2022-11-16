import {allForks, ssz} from "@lodestar/types";
import {
  ContextBytesType,
  EncodedPayloadType,
  Encoding,
  Method,
  ProtocolDefinitionGenerator,
  Version,
} from "../../types.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const Metadata: ProtocolDefinitionGenerator<null, allForks.Metadata> = (_handler, modules) => {
  return {
    method: Method.Metadata,
    version: Version.V1,
    encoding: Encoding.SSZ_SNAPPY,
    handler: async function* metadataHandler(context, req, peerId) {
      context.eventsHandlers.onIncomingRequestBody(context.modules, {method: Method.Metadata, body: req}, peerId);

      yield {type: EncodedPayloadType.ssz, data: modules.metadata.json};
    },
    requestType: () => null,
    responseType: () => ssz.phase0.Metadata,
    contextBytes: {type: ContextBytesType.Empty},
    isSingleResponse: true,
  };
};
