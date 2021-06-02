import {IChainConfig} from "./chainConfig";
import {createIForkConfig, IForkConfig} from "./forkConfig";

export * from "./chainConfig";
export * from "./forkConfig";

/**
 * Chain configuration, eg: run-time configuration, with additional fork information
 */
export type IBeaconConfig = IChainConfig & IForkConfig;

export function createIBeaconConfig(chainConfig: IChainConfig): IBeaconConfig {
  return {
    ...chainConfig,
    ...createIForkConfig(chainConfig),
  };
}
