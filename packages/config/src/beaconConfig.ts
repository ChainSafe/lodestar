import {Root} from "@chainsafe/lodestar-types";
import {createIChainConfig, IChainConfig} from "./chainConfig/index.js";
import {createIForkConfig, IForkConfig} from "./forkConfig/index.js";
import {createICachedGenesis} from "./genesisConfig/index.js";
import {ICachedGenesis} from "./genesisConfig/types.js";

/**
 * Chain run-time configuration with additional fork schedule helpers
 */
export type IChainForkConfig = IChainConfig & IForkConfig;

export type IBeaconConfig = IChainForkConfig & ICachedGenesis;

/**
 * Create an `IBeaconConfig`, filling in missing values with preset defaults
 */
export function createIChainForkConfig(chainConfig: Partial<IChainConfig>): IChainForkConfig {
  const fullChainConfig = createIChainConfig(chainConfig);
  return {
    ...fullChainConfig,
    ...createIForkConfig(fullChainConfig),
  };
}

export function createIBeaconConfig(chainConfig: Partial<IChainConfig>, genesisValidatorsRoot: Root): IBeaconConfig {
  const chainForkConfig = createIChainForkConfig(chainConfig);
  return {
    ...chainForkConfig,
    ...createICachedGenesis(chainForkConfig, genesisValidatorsRoot),
  };
}
