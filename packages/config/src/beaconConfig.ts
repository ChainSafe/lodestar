import {createIChainConfig, IChainConfig} from "./chainConfig";
import {createIForkConfig, IForkConfig} from "./forkConfig";

/**
 * Chain run-time configuration with additional fork schedule helpers
 */
export type IBeaconConfig = IChainConfig & IForkConfig;

/**
 * Create an `IBeaconConfig`, filling in missing values with preset defaults
 */
export function createIBeaconConfig(chainConfig: Partial<IChainConfig>): IBeaconConfig {
  const fullChainConfig = createIChainConfig(chainConfig);
  return {
    ...fullChainConfig,
    ...createIForkConfig(fullChainConfig),
  };
}
