import {chainConfigToJson, IChainConfig} from "@lodestar/config";
import {getParamsArgKey} from "../../../src/options/paramsOptions.js";

/**
 * Serialize partial IChainConfig into object type CLI args
 */
export function configToCliArgs(params: Partial<IChainConfig>): Record<string, unknown> {
  const paramsJson = chainConfigToJson(params as IChainConfig) as Record<keyof IChainConfig, unknown>;
  const args: Record<string, unknown> = {};

  for (const key of Object.keys(paramsJson) as (keyof typeof paramsJson)[]) {
    args[getParamsArgKey(key)] = paramsJson[key];
  }

  return args;
}
