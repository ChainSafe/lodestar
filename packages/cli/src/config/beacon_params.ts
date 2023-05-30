import {
  ChainConfig,
  createChainForkConfig,
  createChainConfig,
  ChainForkConfig,
  chainConfigFromJson,
} from "@lodestar/config";
import {readFile} from "../util/index.js";
import {getNetworkBeaconParams, NetworkName} from "../networks/index.js";
import {
  parseBeaconParamsArgs,
  parseTerminalPowArgs,
  ITerminalPowArgs,
  GlobalArgs,
  defaultNetwork,
} from "../options/index.js";
import {IBeaconParamsUnparsed} from "./types.js";

type BeaconParamsArgs = {
  network?: NetworkName;
  paramsFile?: string;
  additionalParamsCli: IBeaconParamsUnparsed;
};

/**
 * Convenience method to parse yargs CLI args and call getBeaconParams
 * @see getBeaconConfig
 */
export function getBeaconConfigFromArgs(args: GlobalArgs): {config: ChainForkConfig; network: string} {
  const config = createChainForkConfig(getBeaconParamsFromArgs(args));
  return {
    config,
    network: args.network ?? config.CONFIG_NAME ?? defaultNetwork,
  };
}

/**
 * Convenience method to parse yargs CLI args and call getBeaconParams
 * @see getBeaconParams
 */
export function getBeaconParamsFromArgs(args: GlobalArgs): ChainConfig {
  return getBeaconParams({
    network: args.network,
    paramsFile: args.paramsFile,
    additionalParamsCli: {
      ...parseBeaconParamsArgs(args as IBeaconParamsUnparsed),
      ...parseTerminalPowArgs(args as ITerminalPowArgs),
    },
  });
}

/**
 * Initializes BeaconConfig with params
 * @see getBeaconParams
 */
export function getBeaconConfig(args: BeaconParamsArgs): ChainForkConfig {
  return createChainForkConfig(getBeaconParams(args));
}

/**
 * Computes merged IBeaconParams type from (in order)
 * - Network params (diff)
 * - existing params file
 * - CLI flags
 */
export function getBeaconParams({network, paramsFile, additionalParamsCli}: BeaconParamsArgs): ChainConfig {
  // Default network params
  const networkParams: Partial<ChainConfig> = network ? getNetworkBeaconParams(network) : {};
  // Existing user custom params from file
  const fileParams: Partial<ChainConfig> = paramsFile ? parsePartialChainConfigJson(readBeaconParams(paramsFile)) : {};
  // Params from CLI flags
  const cliParams: Partial<ChainConfig> = parsePartialChainConfigJson(additionalParamsCli);

  return createChainConfig({
    ...networkParams,
    ...fileParams,
    ...cliParams,
  });
}

function readBeaconParams(filepath: string): IBeaconParamsUnparsed {
  return readFile(filepath) ?? {};
}

export function parsePartialChainConfigJson(input: Record<string, unknown>): Partial<ChainConfig> {
  return chainConfigFromJson(input);
}
