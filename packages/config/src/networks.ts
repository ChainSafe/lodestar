import {IChainConfig} from "./chainConfig/index.js";
import {mainnetChainConfig} from "./chainConfig/networks/mainnet.js";
import {gnosisChainConfig} from "./chainConfig/networks/gnosis.js";
import {praterChainConfig} from "./chainConfig/networks/prater.js";
import {kilnChainConfig} from "./chainConfig/networks/kiln.js";
import {ropstenChainConfig} from "./chainConfig/networks/ropsten.js";
import {sepoliaChainConfig} from "./chainConfig/networks/sepolia.js";

export {
  mainnetChainConfig,
  gnosisChainConfig,
  praterChainConfig,
  kilnChainConfig,
  ropstenChainConfig,
  sepoliaChainConfig,
};

export type NetworkName = "mainnet" | "gnosis" | "prater" | "kiln" | "ropsten" | "sepolia";
export const networksChainConfig: Record<NetworkName, IChainConfig> = {
  mainnet: mainnetChainConfig,
  gnosis: gnosisChainConfig,
  prater: praterChainConfig,
  kiln: kilnChainConfig,
  ropsten: ropstenChainConfig,
  sepolia: sepoliaChainConfig,
};
