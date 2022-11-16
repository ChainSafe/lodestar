import {phase0, ssz} from "@lodestar/types";
import {ContextBytesType, Encoding, Method, ProtocolDefinitionGenerator, Version} from "../../types.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const Status: ProtocolDefinitionGenerator<phase0.Status, phase0.Status> = (handler) => {
  return {
    method: Method.Status,
    version: Version.V1,
    encoding: Encoding.SSZ_SNAPPY,
    handler: async function* statusHandler(context, req, peerId) {
      context.eventsHandlers.onIncomingRequestBody(context.modules, {method: Method.Status, body: req}, peerId);

      yield* handler(req, peerId);
    },
    requestType: () => ssz.phase0.Status,
    responseType: () => ssz.phase0.Status,
    contextBytes: {type: ContextBytesType.Empty},
    isSingleResponse: true,
  };
};
