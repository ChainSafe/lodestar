import {allForks, ssz} from "@lodestar/types";
import {ContextBytesType, Encoding, ProtocolDefinitionGenerator} from "../types.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const Metadata: ProtocolDefinitionGenerator<null, allForks.Metadata> = (modules, handler) => {
  return {
    method: "metadata",
    version: 1,
    encoding: Encoding.SSZ_SNAPPY,
    handler,
    requestType: () => null,
    responseType: () => ssz.phase0.Metadata,
    contextBytes: {type: ContextBytesType.Empty},
  };
};
