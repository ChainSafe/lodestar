import {createIChainForkConfig} from "../src";
import {defaultChainConfig} from "./chainConfig";

export const chainConfig = defaultChainConfig;
// for testing purpose only
export const config = createIChainForkConfig(defaultChainConfig);
