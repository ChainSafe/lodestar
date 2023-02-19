import {Root} from "@lodestar/types";
import {createChainConfig, ChainConfig} from "./chainConfig/index.js";
import {createForkConfig, ForkConfig} from "./forkConfig/index.js";
import {createCachedGenesis} from "./genesisConfig/index.js";
import {CachedGenesis} from "./genesisConfig/types.js";

/**
 * Chain run-time configuration with additional fork schedule helpers
 */
export type ChainForkConfig = ChainConfig & ForkConfig;

export type BeaconConfig = ChainForkConfig & CachedGenesis;

/**
 * Create an `BeaconConfig`, filling in missing values with preset defaults
 */
export function createChainForkConfig(chainConfig: Partial<ChainConfig>): ChainForkConfig {
  const fullChainConfig = createChainConfig(chainConfig);
  return {
    ...fullChainConfig,
    ...createForkConfig(fullChainConfig),
  };
}

export function createBeaconConfig(chainConfig: Partial<ChainConfig>, genesisValidatorsRoot: Root): BeaconConfig {
  const chainForkConfig = createChainForkConfig(chainConfig);
  return {
    ...chainForkConfig,
    ...createCachedGenesis(chainForkConfig, genesisValidatorsRoot),
  };
}
