/* eslint-disable @typescript-eslint/naming-convention */
import {fromHexString as b} from "@chainsafe/ssz";
import {ChainConfig} from "../types.js";
import {chainConfig as mainnet} from "../presets/mainnet.js";

// Sepolia beacon chain config:
// https://github.com/eth-clients/merge-testnets/blob/main/sepolia-beacon-chain/config.yaml

export const sepoliaChainConfig: ChainConfig = {
  ...mainnet,

  CONFIG_NAME: "sepolia",

  // Genesis
  // ---------------------------------------------------------------
  MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: 1300,
  // # Sunday, June 19, 2022 2:00:00 PM +UTC
  MIN_GENESIS_TIME: 1655647200,
  GENESIS_FORK_VERSION: b("0x90000069"),

  // Forking
  // ---------------------------------------------------------------
  // # Altair
  ALTAIR_FORK_VERSION: b("0x90000070"),
  ALTAIR_FORK_EPOCH: 50,
  // # Merge
  BELLATRIX_FORK_VERSION: b("0x90000071"),
  BELLATRIX_FORK_EPOCH: 100,
  TERMINAL_TOTAL_DIFFICULTY: BigInt("17000000000000000"),
  // Capella
  CAPELLA_FORK_VERSION: b("0x90000072"),
  CAPELLA_FORK_EPOCH: 56832,
  // Deneb
  DENEB_FORK_VERSION: b("0x90000073"),
  DENEB_FORK_EPOCH: 132608,

  // Deposit contract
  // ---------------------------------------------------------------
  DEPOSIT_CHAIN_ID: 11155111,
  DEPOSIT_NETWORK_ID: 11155111,
  DEPOSIT_CONTRACT_ADDRESS: b("0x7f02C3E3c98b133055B8B348B2Ac625669Ed295D"),
};
