/* eslint-disable @typescript-eslint/naming-convention */
import {fromHexString as b} from "@chainsafe/ssz";
import {ChainConfig} from "../types.js";
import {chainConfig as mainnet} from "../presets/mainnet.js";

// Zhejiang beacon chain config:
// https://github.com/eth-clients/merge-testnets/blob/main/sepolia-beacon-chain/config.yaml

export const zhejiangChainConfig: ChainConfig = {
  ...mainnet,

  CONFIG_NAME: "zhejiang",

  // Genesis
  // ---------------------------------------------------------------
  MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: 58000,
  MIN_GENESIS_TIME: 1675263480,
  GENESIS_FORK_VERSION: b("0x00000069"),
  GENESIS_DELAY: 120,

  // Forking
  // ---------------------------------------------------------------
  // # Altair
  ALTAIR_FORK_VERSION: b("0x00000070"),
  ALTAIR_FORK_EPOCH: 0,
  // # Merge
  BELLATRIX_FORK_VERSION: b("0x00000071"),
  BELLATRIX_FORK_EPOCH: 0,
  TERMINAL_TOTAL_DIFFICULTY: BigInt("0"),
  // Capella
  CAPELLA_FORK_VERSION: b("0x00000072"),
  CAPELLA_FORK_EPOCH: 1350,
  // Deneb
  EIP4844_FORK_VERSION: b("0x00000073"),

  // Deposit contract
  // ---------------------------------------------------------------
  DEPOSIT_CHAIN_ID: 1337803,
  DEPOSIT_NETWORK_ID: 1337803,
  DEPOSIT_CONTRACT_ADDRESS: b("0x4242424242424242424242424242424242424242"),
};
