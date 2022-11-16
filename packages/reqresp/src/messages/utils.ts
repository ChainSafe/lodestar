import {ForkName} from "@lodestar/params";
import {ReqRespModules} from "../interface.js";
import {ContextBytesType, ContextBytesFactory} from "../types.js";

export function getContextBytesLightclient<T>(
  forkFromResponse: (response: T) => ForkName,
  modules: ReqRespModules
): ContextBytesFactory<T> {
  return {
    type: ContextBytesType.ForkDigest,
    forkDigestContext: modules.config,
    forkFromResponse,
  };
}
