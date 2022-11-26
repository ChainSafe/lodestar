import {phase0, ssz} from "@lodestar/types";
import {ContextBytesType, Encoding, ProtocolDefinitionGenerator} from "../types.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const Status: ProtocolDefinitionGenerator<phase0.Status, phase0.Status> = (_modules, handler) => {
  return {
    method: "status",
    version: 1,
    encoding: Encoding.SSZ_SNAPPY,
    handler,
    requestType: () => ssz.phase0.Status,
    responseType: () => ssz.phase0.Status,
    contextBytes: {type: ContextBytesType.Empty},
  };
};
