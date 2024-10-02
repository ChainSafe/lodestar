import {
  ChainConfig,
  createChainForkConfig,
  createChainConfig,
  ChainForkConfig,
  chainConfigFromJson,
} from "@lodestar/config";
import {DATA_COLUMN_SIDECAR_SUBNET_COUNT} from "@lodestar/params";
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
  const beaconParams = getBeaconParams({
    network: args.network,
    paramsFile: args.paramsFile,
    additionalParamsCli: {
      ...parseBeaconParamsArgs(args as IBeaconParamsUnparsed),
      ...parseTerminalPowArgs(args as ITerminalPowArgs),
    },
  });

  // Temp
  beaconParams["PEERDAS_FORK_EPOCH"] = beaconParams["EIP7594_FORK_EPOCH"]
  beaconParams["PEERDAS_FORK_VERSION"] = beaconParams["EIP7594_FORK_VERSION"]
  beaconParams["ELECTRA_FORK_EPOCH"] = Infinity

  if (args.supernode) {
    beaconParams["NODE_CUSTODY_REQUIREMENT"] = DATA_COLUMN_SIDECAR_SUBNET_COUNT;
  }
  return beaconParams;
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
