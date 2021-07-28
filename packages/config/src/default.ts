import {createIChainForkConfig} from "./beaconConfig";
import {defaultChainConfig} from "./chainConfig";

export const chainConfig = defaultChainConfig;
// for testing purpose only
export const config = createIChainForkConfig(defaultChainConfig);
