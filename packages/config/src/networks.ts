import {IChainConfig} from "./chainConfig";
import {mainnetChainConfig} from "./chainConfig/networks/mainnet";
import {praterChainConfig} from "./chainConfig/networks/prater";
import {kilnChainConfig} from "./chainConfig/networks/kiln";
import {ropstenChainConfig} from "./chainConfig/networks/ropsten";

export {mainnetChainConfig, praterChainConfig, kilnChainConfig, ropstenChainConfig};

export type NetworkName = "mainnet" | "prater" | "kiln" | "ropsten";
export const networksChainConfig: Record<NetworkName, IChainConfig> = {
  mainnet: mainnetChainConfig,
  prater: praterChainConfig,
  kiln: kilnChainConfig,
  ropsten: ropstenChainConfig,
};
