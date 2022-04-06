import {IChainConfig} from "./chainConfig/index.js";
import {mainnetChainConfig} from "./chainConfig/networks/mainnet.js";
import {praterChainConfig} from "./chainConfig/networks/prater.js";
import {kilnChainConfig} from "./chainConfig/networks/kiln.js";

export {mainnetChainConfig, praterChainConfig, kilnChainConfig};

export type NetworkName = "mainnet" | "prater" | "kiln";
export const networksChainConfig: Record<NetworkName, IChainConfig> = {
  mainnet: mainnetChainConfig,
  prater: praterChainConfig,
  kiln: kilnChainConfig,
};
