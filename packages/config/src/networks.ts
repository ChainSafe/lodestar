import {IChainConfig} from "./chainConfig/index.js";
import {mainnetChainConfig} from "./chainConfig/networks/mainnet.js";
import {gnosisChainConfig} from "./chainConfig/networks/gnosis.js";
import {goerliChainConfig} from "./chainConfig/networks/goerli.js";
import {ropstenChainConfig} from "./chainConfig/networks/ropsten.js";
import {sepoliaChainConfig} from "./chainConfig/networks/sepolia.js";

export {
  mainnetChainConfig,
  gnosisChainConfig,
  goerliChainConfig,
  ropstenChainConfig,
  sepoliaChainConfig,
};

export type NetworkName = "mainnet" | "gnosis" | "goerli" | "ropsten" | "sepolia";
export const networksChainConfig: Record<NetworkName, IChainConfig> = {
  mainnet: mainnetChainConfig,
  gnosis: gnosisChainConfig,
  goerli: goerliChainConfig,
  ropsten: ropstenChainConfig,
  sepolia: sepoliaChainConfig,
};
