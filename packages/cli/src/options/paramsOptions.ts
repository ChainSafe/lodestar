import {chainConfigTypes} from "@lodestar/config";
import {CliCommandOptions, CliOptionDefinition} from "@lodestar/utils";
import {IBeaconParamsUnparsed} from "../config/types.js";
import {ObjectKeys} from "../util/index.js";

// No options are statically declared
// If an arbitrary key notation is used, it removes type safety on most of this CLI arg parsing code.
// Params will be parsed from an args object assuming to contain the required keys

export type IParamsArgs = Record<never, never>;

const getArgKey = (key: keyof IBeaconParamsUnparsed): string => `params.${key}`;

export function parseBeaconParamsArgs(args: Record<string, string | number>): IBeaconParamsUnparsed {
  return ObjectKeys(chainConfigTypes).reduce((beaconParams: Partial<IBeaconParamsUnparsed>, key) => {
    const value = args[getArgKey(key)];
    if (value != null) beaconParams[key] = value;
    return beaconParams;
  }, {});
}

export const paramsOptions: CliCommandOptions<IParamsArgs> = ObjectKeys(chainConfigTypes).reduce(
  (options: Record<string, CliOptionDefinition>, key): Record<string, CliOptionDefinition> => {
    options[getArgKey(key)] = {
      hidden: true,
      type: "string",
      group: "params",
    };
    return options;
  },
  {}
);
