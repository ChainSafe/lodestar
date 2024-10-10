import {fromHex as b} from "@lodestar/utils";
import {ChainConfig} from "../types.js";
import {gnosisChainConfig as gnosis} from "./gnosis.js";

// Chiado beacon chain config:
// https://github.com/gnosischain/configs/blob/main/chiado/config.yaml

export const chiadoChainConfig: ChainConfig = {
  ...gnosis,

  // NOTE: Only add diff values
  CONFIG_NAME: "chiado",

  // Transition
  TERMINAL_TOTAL_DIFFICULTY: BigInt("231707791542740786049188744689299064356246512"),

  // Deposit contract
  DEPOSIT_CHAIN_ID: 10200,
  DEPOSIT_NETWORK_ID: 10200,
  DEPOSIT_CONTRACT_ADDRESS: b("0xb97036A26259B7147018913bD58a774cf91acf25"),

  // 10 October 2022 10:00:00 GMT+0000
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
  // Capella
  CAPELLA_FORK_VERSION: b("0x0300006f"),
  CAPELLA_FORK_EPOCH: 244224, // Wed May 24 2023 13:12:00 GMT+0000
  // Deneb
  DENEB_FORK_VERSION: b("0x0400006f"),
  DENEB_FORK_EPOCH: 516608, // Wed Jan 31 2024 18:15:40 GMT+0000
};
