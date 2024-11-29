import {ChainConfig} from "./chainConfig/index.js";
import {chiadoChainConfig} from "./chainConfig/networks/chiado.js";
import {ephemeryChainConfig} from "./chainConfig/networks/ephemery.js";
import {gnosisChainConfig} from "./chainConfig/networks/gnosis.js";
import {holeskyChainConfig} from "./chainConfig/networks/holesky.js";
import {mainnetChainConfig} from "./chainConfig/networks/mainnet.js";
import {mekongChainConfig} from "./chainConfig/networks/mekong.js";
import {sepoliaChainConfig} from "./chainConfig/networks/sepolia.js";

export {
  mainnetChainConfig,
  gnosisChainConfig,
  sepoliaChainConfig,
  holeskyChainConfig,
  chiadoChainConfig,
  ephemeryChainConfig,
  mekongChainConfig,
};

export type NetworkName = "mainnet" | "gnosis" | "sepolia" | "holesky" | "chiado" | "ephemery" | "mekong";
export const networksChainConfig: Record<NetworkName, ChainConfig> = {
  mainnet: mainnetChainConfig,
  gnosis: gnosisChainConfig,
  sepolia: sepoliaChainConfig,
  holesky: holeskyChainConfig,
  chiado: chiadoChainConfig,
  ephemery: ephemeryChainConfig,
  mekong: mekongChainConfig,
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
  sepolia: {
    genesisTime: 1655733600,
    genesisValidatorsRoot: "0xd8ea171f3c94aea21ebc42a1ed61052acf3f9209c00e4efbaaddac09ed9b8078",
  },
  holesky: {
    genesisTime: 1695902400,
    genesisValidatorsRoot: "0x9143aa7c615a7f7115e2b6aac319c03529df8242ae705fba9df39b79c59fa8b1",
  },
  chiado: {
    genesisTime: 1665396300,
    genesisValidatorsRoot: "0x9d642dac73058fbf39c0ae41ab1e34e4d889043cb199851ded7095bc99eb4c1e",
  },
  ephemery: {
    genesisTime: ephemeryChainConfig.MIN_GENESIS_TIME + ephemeryChainConfig.GENESIS_DELAY,
    genesisValidatorsRoot: "0x0000000000000000000000000000000000000000000000000000000000000000",
  },
  mekong: {
    genesisTime: 1730372340,
    genesisValidatorsRoot: "0x9838240bca889c52818d7502179b393a828f61f15119d9027827c36caeb67db7",
  },
};
