import {createChainForkConfig} from "./beacon_config.js";
import {defaultChainConfig} from "./chain_config/index.js";

export const chainConfig = defaultChainConfig;
// for testing purpose only
export const config = createChainForkConfig(defaultChainConfig);
