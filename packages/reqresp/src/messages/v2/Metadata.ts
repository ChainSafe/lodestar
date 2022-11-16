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
export const MetadataV2: ProtocolDefinitionGenerator<null, allForks.Metadata> = (_handler, modules) => {
  return {
    method: Method.Metadata,
    version: Version.V2,
    encoding: Encoding.SSZ_SNAPPY,
    handler: async function* metadataV2Handler(context, req, peerId) {
      context.eventsHandlers.onIncomingRequestBody(context.modules, {method: Method.Metadata, body: req}, peerId);

      yield {type: EncodedPayloadType.ssz, data: modules.metadata.json};
    },
    requestType: () => null,
    responseType: () => ssz.altair.Metadata,
    contextBytes: {type: ContextBytesType.Empty},
    isSingleResponse: true,
  };
};
