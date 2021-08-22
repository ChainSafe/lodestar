import {createIChainForkConfig, IChainForkConfig} from "./beaconConfig";
import {mainnetChainConfig} from "./chainConfig/networks/mainnet";
import {pyrmontChainConfig} from "./chainConfig/networks/pyrmont";
import {praterChainConfig} from "./chainConfig/networks/prater";

export {mainnetChainConfig, pyrmontChainConfig, praterChainConfig};
// for testing purpose only
export const mainnet = createIChainForkConfig(mainnetChainConfig);
export const pyrmont = createIChainForkConfig(pyrmontChainConfig);
export const prater = createIChainForkConfig(praterChainConfig);

export type NetworkName = "mainnet" | "pyrmont" | "prater";
export const networksChainConfig: Record<NetworkName, IChainForkConfig> = {mainnet, pyrmont, prater};
