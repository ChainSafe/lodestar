import {ForkName} from "@lodestar/params";
import {ReqRespHandlerContext} from "../interface.js";
import {ContextBytesType, ContextBytesFactory} from "../types.js";

export function getContextBytesLightclient<T>(
  forkFromResponse: (response: T) => ForkName,
  modules: ReqRespHandlerContext["modules"]
): ContextBytesFactory<T> {
  return {
    type: ContextBytesType.ForkDigest,
    forkDigestContext: modules.config,
    forkFromResponse,
  };
}

export const getHandlerRequiredErrorFor = (method: string): Error =>
  new Error(`Handler is required for method "${method}."`);
