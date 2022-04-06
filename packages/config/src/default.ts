import {createIChainForkConfig} from "./beaconConfig.js";
import {defaultChainConfig} from "./chainConfig/index.js";

export const chainConfig = defaultChainConfig;
// for testing purpose only
export const config = createIChainForkConfig(defaultChainConfig);
