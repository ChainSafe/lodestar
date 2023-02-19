import {Options} from "yargs";
import {ChainConfig, chainConfigTypes} from "@lodestar/config";
import {IBeaconParamsUnparsed} from "../config/types.js";
import {ObjectKeys, CliCommandOptions} from "../util/index.js";

// No options are statically declared
// If an arbitraty key notation is used, it removes typesafety on most of this CLI arg parsing code.
// Params will be parsed from an args object assuming to contain the required keys

export type ITerminalPowArgs = {
  "terminal-total-difficulty-override"?: string;
  "terminal-block-hash-override"?: string;
  "terminal-block-hash-epoch-override"?: string;
};
export type IParamsArgs = Record<never, never> & ITerminalPowArgs;

const getArgKey = (key: keyof IBeaconParamsUnparsed): string => `params.${key}`;

export function parseBeaconParamsArgs(args: Record<string, string | number>): IBeaconParamsUnparsed {
  return ObjectKeys(chainConfigTypes).reduce((beaconParams: Partial<IBeaconParamsUnparsed>, key) => {
    const value = args[getArgKey(key)];
    if (value != null) beaconParams[key] = value;
    return beaconParams;
  }, {});
}

const paramsOptionsByName = ObjectKeys(chainConfigTypes).reduce(
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

const terminalArgsToParamsMap: {[K in keyof ITerminalPowArgs]: keyof ChainConfig} = {
  "terminal-total-difficulty-override": "TERMINAL_TOTAL_DIFFICULTY",
  "terminal-block-hash-override": "TERMINAL_BLOCK_HASH",
  "terminal-block-hash-epoch-override": "TERMINAL_BLOCK_HASH_ACTIVATION_EPOCH",
};

export function parseTerminalPowArgs(args: ITerminalPowArgs): IBeaconParamsUnparsed {
  const parsedArgs = ObjectKeys(terminalArgsToParamsMap).reduce((beaconParams: Partial<IBeaconParamsUnparsed>, key) => {
    const paramOption = terminalArgsToParamsMap[key];
    const value = args[key];
    if (paramOption != null && value != null) beaconParams[paramOption] = value;
    return beaconParams;
  }, {});
  return parsedArgs;
}

export const paramsOptions: CliCommandOptions<IParamsArgs> = {
  ...paramsOptionsByName,

  "terminal-total-difficulty-override": {
    description: "Terminal PoW block TTD override",
    type: "string",
  },

  "terminal-block-hash-override": {
    description: "Terminal PoW block hash override",
    type: "string",
  },

  "terminal-block-hash-epoch-override": {
    description: "Terminal PoW block hash override activation epoch",
    type: "string",
  },
};
