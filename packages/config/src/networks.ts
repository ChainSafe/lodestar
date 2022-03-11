import {IChainConfig} from "./chainConfig";
import {mainnetChainConfig} from "./chainConfig/networks/mainnet";
import {praterChainConfig} from "./chainConfig/networks/prater";
import {kilnChainConfig} from "./chainConfig/networks/kiln";

export {mainnetChainConfig, praterChainConfig, kilnChainConfig};

export type NetworkName = "mainnet" | "prater" | "kiln";
export const networksChainConfig: Record<NetworkName, IChainConfig> = {
  mainnet: mainnetChainConfig,
  prater: praterChainConfig,
  kiln: kilnChainConfig,
};
