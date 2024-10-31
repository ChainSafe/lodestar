import {fromHex as b} from "@lodestar/utils";
import {ChainConfig} from "../types.js";
import {chainConfig as mainnet} from "../configs/mainnet.js";

// Mekong beacon chain config:
// https://github.com/ethpandaops/mekong-devnets/blob/master/network-configs/devnet-0/metadata/config.yaml

export const mekongChainConfig: ChainConfig = {
  ...mainnet,

  CONFIG_NAME: "mekong",

  // Genesis
  // ---------------------------------------------------------------
  MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: 100000,
  MIN_GENESIS_TIME: 1730372340,
  GENESIS_FORK_VERSION: b("0x10000000"),
  GENESIS_DELAY: 60,

  // Forking
  // ---------------------------------------------------------------
  // # Altair
  ALTAIR_FORK_VERSION: b("0x20000000"),
  ALTAIR_FORK_EPOCH: 0,
  // # Merge
  BELLATRIX_FORK_VERSION: b("0x30000000"),
  BELLATRIX_FORK_EPOCH: 0,
  TERMINAL_TOTAL_DIFFICULTY: BigInt("0"),
  // Capella
  CAPELLA_FORK_VERSION: b("0x40000000"),
  CAPELLA_FORK_EPOCH: 0,
  // Deneb
  DENEB_FORK_VERSION: b("0x50637624"),
  DENEB_FORK_EPOCH: 0,
  // Electra
  ELECTRA_FORK_VERSION: b("0x60637624"),
  ELECTRA_FORK_EPOCH: 256,

  // Deposit contract
  // ---------------------------------------------------------------
  DEPOSIT_CHAIN_ID: 7078815900,
  DEPOSIT_NETWORK_ID: 7078815900,
  DEPOSIT_CONTRACT_ADDRESS: b("0x4242424242424242424242424242424242424242"),
};
