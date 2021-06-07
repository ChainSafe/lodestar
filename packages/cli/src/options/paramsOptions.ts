import {Options} from "yargs";
import {IBeaconParamsUnparsed} from "../config/types";
import {ObjectKeys} from "../util";
import {ChainConfig, IChainConfig} from "@chainsafe/lodestar-config";

// No options are statically declared
// If an arbitraty key notation is used, it removes typesafety on most of this CLI arg parsing code.
// Params will be parsed from an args object assuming to contain the required keys
export type IParamsArgs = Record<never, never>;

const getArgKey = (key: keyof IBeaconParamsUnparsed): string => `params.${key}`;

export function parseBeaconParamsArgs(args: Record<string, string | number>): IBeaconParamsUnparsed {
  return ((ObjectKeys(ChainConfig.fields) as unknown) as (keyof IChainConfig)[]).reduce(
    (beaconParams: Partial<IBeaconParamsUnparsed>, key) => {
      const value = args[getArgKey(key)];
      if (value != null) beaconParams[key] = value;
      return beaconParams;
    },
    {}
  );
}

export const paramsOptions = ((ObjectKeys(ChainConfig.fields) as unknown) as (keyof IChainConfig)[]).reduce(
  (options: Record<string, Options>, key): Record<string, Options> => ({
    ...options,
    [getArgKey(key)]: {
      hidden: true,
      type: "string",
      group: "params",
    },
  }),
  {}
);
