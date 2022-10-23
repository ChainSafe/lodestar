import {createIBeaconConfig, createIChainForkConfig, IBeaconConfig} from "./beaconConfig.js";
import {defaultChainConfig} from "./chainConfig/index.js";

export const chainConfig = defaultChainConfig;
// for testing purpose only
export const config: IBeaconConfig = createIBeaconConfig(
  createIChainForkConfig(defaultChainConfig),
  Buffer.alloc(32, 0xaa)
);
