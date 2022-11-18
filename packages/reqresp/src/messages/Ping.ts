import {phase0, ssz} from "@lodestar/types";
import {ContextBytesType, Encoding, ProtocolDefinitionGenerator} from "../types.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const Ping: ProtocolDefinitionGenerator<phase0.Ping, phase0.Ping> = (modules, handler) => {
  return {
    method: "ping",
    version: 1,
    encoding: Encoding.SSZ_SNAPPY,
    handler,
    requestType: () => ssz.phase0.Ping,
    responseType: () => ssz.phase0.Ping,
    renderRequestBody: (req) => req.toString(10),
    contextBytes: {type: ContextBytesType.Empty},
  };
};
