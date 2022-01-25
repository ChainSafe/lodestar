import {IChainConfig} from "./chainConfig";
import {mainnetChainConfig} from "./chainConfig/networks/mainnet";
import {pyrmontChainConfig} from "./chainConfig/networks/pyrmont";
import {praterChainConfig} from "./chainConfig/networks/prater";
import {kintsugiChainConfig} from "./chainConfig/networks/kintsugi";

export {mainnetChainConfig, pyrmontChainConfig, praterChainConfig, kintsugiChainConfig};

export type NetworkName = "mainnet" | "pyrmont" | "prater" | "kintsugi";
export const networksChainConfig: Record<NetworkName, IChainConfig> = {
  mainnet: mainnetChainConfig,
  pyrmont: pyrmontChainConfig,
  prater: praterChainConfig,
  kintsugi: kintsugiChainConfig,
};
