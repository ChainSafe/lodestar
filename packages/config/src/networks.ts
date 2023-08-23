import {ChainConfig} from "./chainConfig/index.js";
import {mainnetChainConfig} from "./chainConfig/networks/mainnet.js";
import {gnosisChainConfig} from "./chainConfig/networks/gnosis.js";
import {goerliChainConfig} from "./chainConfig/networks/goerli.js";
import {ropstenChainConfig} from "./chainConfig/networks/ropsten.js";
import {sepoliaChainConfig} from "./chainConfig/networks/sepolia.js";
import {holeskyChainConfig} from "./chainConfig/networks/holesky.js";
import {chiadoChainConfig} from "./chainConfig/networks/chiado.js";

export {
  mainnetChainConfig,
  gnosisChainConfig,
  goerliChainConfig,
  ropstenChainConfig,
  sepoliaChainConfig,
  holeskyChainConfig,
  chiadoChainConfig,
};

export type NetworkName = "mainnet" | "gnosis" | "goerli" | "ropsten" | "sepolia" | "holesky" | "chiado";
export const networksChainConfig: Record<NetworkName, ChainConfig> = {
  mainnet: mainnetChainConfig,
  gnosis: gnosisChainConfig,
  goerli: goerliChainConfig,
  ropsten: ropstenChainConfig,
  sepolia: sepoliaChainConfig,
  holesky: holeskyChainConfig,
  chiado: chiadoChainConfig,
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
  holesky: {
    genesisTime: 1694786400,
    genesisValidatorsRoot: "0x9143aa7c615a7f7115e2b6aac319c03529df8242ae705fba9df39b79c59fa8b1",
  },
  chiado: {
    genesisTime: 1665396300,
    genesisValidatorsRoot: "0x9d642dac73058fbf39c0ae41ab1e34e4d889043cb199851ded7095bc99eb4c1e",
  },
};
