/* eslint-disable @typescript-eslint/naming-convention */
import {fromHexString as b} from "@chainsafe/ssz";
import {ChainConfig} from "../types.js";
import {chainConfig as mainnet} from "../presets/mainnet.js";

// Holesky beacon chain config:
// https://github.com/eth-clients/holesky/blob/main/custom_config_data/config.yaml

export const holeskyChainConfig: ChainConfig = {
  ...mainnet,

  CONFIG_NAME: "holesky",

  // Genesis
  // ---------------------------------------------------------------
  MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: 16384,
  // Sep-15-2023 14:55:00 +UTC
  MIN_GENESIS_TIME: 1694786100,
  GENESIS_DELAY: 300,
  GENESIS_FORK_VERSION: b("0x00017000"),

  // Forking
  // ---------------------------------------------------------------
  // # Altair
  ALTAIR_FORK_VERSION: b("0x10017000"),
  ALTAIR_FORK_EPOCH: 0,
  // # Merge
  BELLATRIX_FORK_VERSION: b("0x20017000"),
  BELLATRIX_FORK_EPOCH: 0,
  TERMINAL_TOTAL_DIFFICULTY: BigInt("0"),
  // Capella
  CAPELLA_FORK_VERSION: b("0x30017000"),
  CAPELLA_FORK_EPOCH: 256,

  // # 28,000,000,000 Gwei to ensure quicker ejection
  EJECTION_BALANCE: 28000000000,

  // Deposit contract
  // ---------------------------------------------------------------
  DEPOSIT_CHAIN_ID: 17000,
  DEPOSIT_NETWORK_ID: 17000,
  DEPOSIT_CONTRACT_ADDRESS: b("0x4242424242424242424242424242424242424242"),
};
