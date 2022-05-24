import {IChainConfig} from "./chainConfig/index.js";
import {mainnetChainConfig} from "./chainConfig/networks/mainnet.js";
import {praterChainConfig} from "./chainConfig/networks/prater.js";
import {kilnChainConfig} from "./chainConfig/networks/kiln.js";
import {ropstenChainConfig} from "./chainConfig/networks/ropsten.js";

export {mainnetChainConfig, praterChainConfig, kilnChainConfig, ropstenChainConfig};

export type NetworkName = "mainnet" | "prater" | "kiln" | "ropsten";
export const networksChainConfig: Record<NetworkName, IChainConfig> = {
  mainnet: mainnetChainConfig,
  prater: praterChainConfig,
  kiln: kilnChainConfig,
  ropsten: ropstenChainConfig,
};
