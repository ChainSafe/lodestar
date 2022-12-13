import {phase0, ssz} from "@lodestar/types";
import {ContextBytesType, Encoding, ProtocolDefinitionGenerator} from "../types.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const Goodbye: ProtocolDefinitionGenerator<phase0.Goodbye, phase0.Goodbye> = (_modules, handler) => {
  return {
    method: "goodbye",
    version: 1,
    encoding: Encoding.SSZ_SNAPPY,
    handler,
    requestType: () => ssz.phase0.Goodbye,
    responseType: () => ssz.phase0.Goodbye,
    ignoreResponse: true,
    renderRequestBody: (req) => req.toString(10),
    contextBytes: {type: ContextBytesType.Empty},
  };
};
