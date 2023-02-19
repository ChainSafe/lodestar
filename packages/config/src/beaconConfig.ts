import {Root} from "@lodestar/types";
import {createIChainConfig, IChainConfig} from "./chainConfig/index.js";
import {createForkConfig, ForkConfig} from "./forkConfig/index.js";
import {createCachedGenesis} from "./genesisConfig/index.js";
import {CachedGenesis} from "./genesisConfig/types.js";

/**
 * Chain run-time configuration with additional fork schedule helpers
 */
export type IChainForkConfig = IChainConfig & ForkConfig;

export type IBeaconConfig = IChainForkConfig & CachedGenesis;

/**
 * Create an `IBeaconConfig`, filling in missing values with preset defaults
 */
export function createIChainForkConfig(chainConfig: Partial<IChainConfig>): IChainForkConfig {
  const fullChainConfig = createIChainConfig(chainConfig);
  return {
    ...fullChainConfig,
    ...createForkConfig(fullChainConfig),
  };
}

export function createIBeaconConfig(chainConfig: Partial<IChainConfig>, genesisValidatorsRoot: Root): IBeaconConfig {
  const chainForkConfig = createIChainForkConfig(chainConfig);
  return {
    ...chainForkConfig,
    ...createCachedGenesis(chainForkConfig, genesisValidatorsRoot),
  };
}
