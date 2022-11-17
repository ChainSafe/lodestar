import {phase0, ssz} from "@lodestar/types";
import {ContextBytesType, Encoding, Method, ProtocolDefinitionGenerator, Version} from "../../types.js";
import {getHandlerRequiredErrorFor} from "../utils.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const Status: ProtocolDefinitionGenerator<phase0.Status, phase0.Status> = (_modules, handler) => {
  if (!handler) {
    throw getHandlerRequiredErrorFor(Method.Status);
  }

  return {
    method: Method.Status,
    version: Version.V1,
    encoding: Encoding.SSZ_SNAPPY,
    handler: async function* statusHandler(context, req, peerId) {
      context.eventHandlers.onIncomingRequestBody({method: Method.Status, body: req}, peerId);

      yield* handler(req, peerId);
    },
    requestType: () => ssz.phase0.Status,
    responseType: () => ssz.phase0.Status,
    contextBytes: {type: ContextBytesType.Empty},
    isSingleResponse: true,
  };
};
