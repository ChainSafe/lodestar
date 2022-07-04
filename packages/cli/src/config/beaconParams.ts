import {
  IChainConfig,
  createIChainForkConfig,
  createIChainConfig,
  IChainForkConfig,
  chainConfigFromJson,
} from "@lodestar/config";
import {readFile} from "../util/index.js";
import {getNetworkBeaconParams, NetworkName} from "../networks/index.js";
import {getGlobalPaths, IGlobalPaths} from "../paths/global.js";
import {parseBeaconParamsArgs, parseTerminalPowArgs, ITerminalPowArgs} from "../options/index.js";
import {IBeaconParamsUnparsed} from "./types.js";

type IBeaconParamsCliArgs = {
  network?: NetworkName;
  paramsFile: string;
} & Partial<IGlobalPaths>;

interface IBeaconParamsArgs {
  network?: NetworkName;
  paramsFile?: string;
  additionalParamsCli: IBeaconParamsUnparsed;
}

/**
 * Convenience method to parse yargs CLI args and call getBeaconParams
 * @see getBeaconConfig
 */
export function getBeaconConfigFromArgs(args: IBeaconParamsCliArgs): IChainForkConfig {
  return createIChainForkConfig(getBeaconParamsFromArgs(args));
}

/**
 * Convenience method to parse yargs CLI args and call getBeaconParams
 * @see getBeaconParams
 */
export function getBeaconParamsFromArgs(args: IBeaconParamsCliArgs): IChainConfig {
  return getBeaconParams({
    network: args.network,
    paramsFile: getGlobalPaths(args).paramsFile,
    additionalParamsCli: {
      ...parseBeaconParamsArgs(args as Record<string, string | number>),
      ...parseTerminalPowArgs(args as ITerminalPowArgs),
    },
  });
}

/**
 * Initializes IBeaconConfig with params
 * @see getBeaconParams
 */
export function getBeaconConfig(args: IBeaconParamsArgs): IChainForkConfig {
  return createIChainForkConfig(getBeaconParams(args));
}

/**
 * Computes merged IBeaconParams type from (in order)
 * - Network params (diff)
 * - existing params file
 * - CLI flags
 */
export function getBeaconParams({network, paramsFile, additionalParamsCli}: IBeaconParamsArgs): IChainConfig {
  // Default network params
  const networkParams: Partial<IChainConfig> = network ? getNetworkBeaconParams(network) : {};
  // Existing user custom params from file
  const fileParams: Partial<IChainConfig> = paramsFile
    ? parsePartialIChainConfigJson(readBeaconParams(paramsFile))
    : {};
  // Params from CLI flags
  const cliParams: Partial<IChainConfig> = parsePartialIChainConfigJson(additionalParamsCli);

  return createIChainConfig({
    ...networkParams,
    ...fileParams,
    ...cliParams,
  });
}

function readBeaconParams(filepath: string): IBeaconParamsUnparsed {
  return readFile(filepath) ?? {};
}

export function parsePartialIChainConfigJson(input: Record<string, unknown>): Partial<IChainConfig> {
  return chainConfigFromJson(input);
}
