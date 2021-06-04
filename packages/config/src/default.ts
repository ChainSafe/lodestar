import {createIBeaconConfig} from "./beaconConfig";
import {defaultChainConfig} from "./chainConfig";

export const chainConfig = defaultChainConfig;
export const config = createIBeaconConfig(defaultChainConfig);
