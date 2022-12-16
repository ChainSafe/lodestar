import {IBeaconConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {ContextBytesType, ContextBytesFactory} from "../types.js";

export function getContextBytesLightclient<T>(
  forkFromResponse: (response: T) => ForkName,
  modules: {config: IBeaconConfig}
): ContextBytesFactory<T> {
  return {
    type: ContextBytesType.ForkDigest,
    forkDigestContext: modules.config,
    forkFromResponse,
  };
}
