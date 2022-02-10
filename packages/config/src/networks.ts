import {IChainConfig} from "./chainConfig";
import {mainnetChainConfig} from "./chainConfig/networks/mainnet";
import {praterChainConfig} from "./chainConfig/networks/prater";
import {kintsugiChainConfig} from "./chainConfig/networks/kintsugi";

export {mainnetChainConfig, praterChainConfig, kintsugiChainConfig};

export type NetworkName = "mainnet" | "prater" | "kintsugi";
export const networksChainConfig: Record<NetworkName, IChainConfig> = {
  mainnet: mainnetChainConfig,
  prater: praterChainConfig,
  kintsugi: kintsugiChainConfig,
};
