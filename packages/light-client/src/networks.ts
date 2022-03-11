import {RootHex} from "@chainsafe/lodestar-types";

enum NetworkName {
  mainnet = "mainnet",
  prater = "prater",
  kintsugi = "kintsugi",
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
  [NetworkName.prater]: {
    genesisTime: 1616508000,
    genesisValidatorsRoot: "0x043db0d9a83813551ee2f33450d23797757d430911a9320530ad8a0eabc43efb",
  },
  [NetworkName.kintsugi]: {
    genesisTime: 1639659900,
    genesisValidatorsRoot: "0xff411ff2797afc5cb9cc3309533ccae59347f8154ef51661289270c06ab13383",
  },
};
