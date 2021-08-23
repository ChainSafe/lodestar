import {createIChainForkConfig} from "./beaconConfig";
import {chainConfig as mainnetChainConfig} from "./chainConfig/presets/mainnet";
import {chainConfig as minimalChainConfig} from "./chainConfig/presets/minimal";

export {mainnetChainConfig, minimalChainConfig};
// for testing purpose only
export const mainnet = createIChainForkConfig(mainnetChainConfig);
export const minimal = createIChainForkConfig(minimalChainConfig);
