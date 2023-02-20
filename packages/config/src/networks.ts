import {ChainConfig} from "./chainConfig/index.js";
import {mainnetChainConfig} from "./chainConfig/networks/mainnet.js";
import {gnosisChainConfig} from "./chainConfig/networks/gnosis.js";
import {goerliChainConfig} from "./chainConfig/networks/goerli.js";
import {ropstenChainConfig} from "./chainConfig/networks/ropsten.js";
import {sepoliaChainConfig} from "./chainConfig/networks/sepolia.js";
import {chiadoChainConfig} from "./chainConfig/networks/chiado.js";
import {zhejiangChainConfig} from "./chainConfig/networks/zhejiang.js";

export {
  mainnetChainConfig,
  gnosisChainConfig,
  goerliChainConfig,
  ropstenChainConfig,
  sepoliaChainConfig,
  chiadoChainConfig,
  zhejiangChainConfig,
};

export type NetworkName = "mainnet" | "gnosis" | "goerli" | "ropsten" | "sepolia" | "chiado" | "zhejiang";
export const networksChainConfig: Record<NetworkName, ChainConfig> = {
  mainnet: mainnetChainConfig,
  gnosis: gnosisChainConfig,
  goerli: goerliChainConfig,
  ropsten: ropstenChainConfig,
  sepolia: sepoliaChainConfig,
  chiado: chiadoChainConfig,
  zhejiang: zhejiangChainConfig,
};

export type GenesisData = {
  genesisTime: number;
  genesisValidatorsRoot: string;
};

export const genesisData: Record<NetworkName, GenesisData> = {
  mainnet: {
    genesisTime: 1606824023,
    genesisValidatorsRoot: "0x4b363db94e286120d76eb905340fdd4e54bfe9f06bf33ff6cf5ad27f511bfe95",
  },
  gnosis: {
    genesisTime: 1638993340,
    genesisValidatorsRoot: "0xf5dcb5564e829aab27264b9becd5dfaa017085611224cb3036f573368dbb9d47",
  },
  goerli: {
    genesisTime: 1616508000,
    genesisValidatorsRoot: "0x043db0d9a83813551ee2f33450d23797757d430911a9320530ad8a0eabc43efb",
  },
  ropsten: {
    genesisTime: 1653922800,
    genesisValidatorsRoot: "0x44f1e56283ca88b35c789f7f449e52339bc1fefe3a45913a43a6d16edcd33cf1",
  },
  sepolia: {
    genesisTime: 1655733600,
    genesisValidatorsRoot: "0xd8ea171f3c94aea21ebc42a1ed61052acf3f9209c00e4efbaaddac09ed9b8078",
  },
  chiado: {
    genesisTime: 1665396300,
    genesisValidatorsRoot: "0x9d642dac73058fbf39c0ae41ab1e34e4d889043cb199851ded7095bc99eb4c1e",
  },
  zhejiang: {
    genesisTime: 1675263600,
    genesisValidatorsRoot: "0x53a92d8f2bb1d85f62d16a156e6ebcd1bcaba652d0900b2c2f387826f3481f6f",
  },
};
