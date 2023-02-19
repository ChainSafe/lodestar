/* eslint-disable @typescript-eslint/naming-convention */
import {fromHexString as b} from "@chainsafe/ssz";
import {PresetName} from "@lodestar/params";
import {ChainConfig} from "../types.js";
import {chainConfig as mainnet} from "../presets/mainnet.js";

export const chiadoChainConfig: ChainConfig = {
  ...mainnet,

  // NOTE: Only add diff values
  PRESET_BASE: PresetName.gnosis,
  CONFIG_NAME: "chiado",

  // Transition
  TERMINAL_TOTAL_DIFFICULTY: BigInt("231707791542740786049188744689299064356246512"),
  TERMINAL_BLOCK_HASH: b("0x0000000000000000000000000000000000000000000000000000000000000000"),
  TERMINAL_BLOCK_HASH_ACTIVATION_EPOCH: Infinity,

  SECONDS_PER_SLOT: 5,
  SECONDS_PER_ETH1_BLOCK: 6,
  ETH1_FOLLOW_DISTANCE: 1024,
  CHURN_LIMIT_QUOTIENT: 4096,

  // Ethereum Goerli testnet
  DEPOSIT_CHAIN_ID: 10200,
  DEPOSIT_NETWORK_ID: 10200,
  DEPOSIT_CONTRACT_ADDRESS: b("0xb97036A26259B7147018913bD58a774cf91acf25"),

  // Dec 8, 2021, 13:00 UTC
  MIN_GENESIS_TIME: 1665396000,
  MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: 6000,
  GENESIS_FORK_VERSION: b("0x0000006f"),
  GENESIS_DELAY: 300,

  // Forking
  ALTAIR_FORK_VERSION: b("0x0100006f"),
  ALTAIR_FORK_EPOCH: 90,
  // Bellatrix
  BELLATRIX_FORK_VERSION: b("0x0200006f"),
  BELLATRIX_FORK_EPOCH: 180,
};
