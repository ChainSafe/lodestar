import {RootHex} from "@lodestar/types";

enum NetworkName {
  mainnet = "mainnet",
  goerli = "goerli",
  ropsten = "ropsten",
}

export type GenesisDataHex = {
  genesisTime: number;
  genesisValidatorsRoot: RootHex;
};

export type GenesisData = {
  genesisTime: number;
  genesisValidatorsRoot: RootHex | Uint8Array;
};

export const networkGenesis: Record<NetworkName, GenesisDataHex> = {
  [NetworkName.mainnet]: {
    genesisTime: 1606824023,
    genesisValidatorsRoot: "0x4b363db94e286120d76eb905340fdd4e54bfe9f06bf33ff6cf5ad27f511bfe95",
  },
  [NetworkName.goerli]: {
    genesisTime: 1616508000,
    genesisValidatorsRoot: "0x043db0d9a83813551ee2f33450d23797757d430911a9320530ad8a0eabc43efb",
  },
  [NetworkName.ropsten]: {
    genesisTime: 1653922800,
    genesisValidatorsRoot: "0x44f1e56283ca88b35c789f7f449e52339bc1fefe3a45913a43a6d16edcd33cf1",
  },
};
