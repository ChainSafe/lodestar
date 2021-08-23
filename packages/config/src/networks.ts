import {IChainConfig} from "./chainConfig";
import {mainnetChainConfig} from "./chainConfig/networks/mainnet";
import {pyrmontChainConfig} from "./chainConfig/networks/pyrmont";
import {praterChainConfig} from "./chainConfig/networks/prater";

export {mainnetChainConfig, pyrmontChainConfig, praterChainConfig};

export type NetworkName = "mainnet" | "pyrmont" | "prater";
export const networksChainConfig: Record<NetworkName, IChainConfig> = {
  mainnet: mainnetChainConfig,
  pyrmont: pyrmontChainConfig,
  prater: praterChainConfig,
};
