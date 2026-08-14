import {fromHex as b} from "@lodestar/utils";
import {chainConfig as mainnet} from "../configs/mainnet.js";
import {ChainConfig} from "../types.js";

// Plataberget beacon chain config:
// https://github.com/ethpandaops/glamsterdam-devnets/blob/master/network-configs/devnet-8/metadata/config.yaml

export const platabergetChainConfig: ChainConfig = {
  ...mainnet,

  CONFIG_NAME: "plataberget",

  // Transition
  // ---------------------------------------------------------------
  TERMINAL_TOTAL_DIFFICULTY: BigInt("0"),

  // Genesis
  // ---------------------------------------------------------------
  MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: 84000,
  // 2026-Aug-13 12:00:00 PM UTC
  MIN_GENESIS_TIME: 1786622400,
  GENESIS_DELAY: 0,
  GENESIS_FORK_VERSION: b("0x10733183"),

  // Forking
  // ---------------------------------------------------------------
  // Altair
  ALTAIR_FORK_VERSION: b("0x20733183"),
  ALTAIR_FORK_EPOCH: 0,
  // Bellatrix
  BELLATRIX_FORK_VERSION: b("0x30733183"),
  BELLATRIX_FORK_EPOCH: 0,
  // Capella
  CAPELLA_FORK_VERSION: b("0x40733183"),
  CAPELLA_FORK_EPOCH: 0,
  // Deneb
  DENEB_FORK_VERSION: b("0x50733183"),
  DENEB_FORK_EPOCH: 0,
  // Electra
  ELECTRA_FORK_VERSION: b("0x60733183"),
  ELECTRA_FORK_EPOCH: 0,
  // Fulu
  FULU_FORK_VERSION: b("0x70733183"),
  FULU_FORK_EPOCH: 0,
  // Gloas
  GLOAS_FORK_VERSION: b("0x80733183"),
  GLOAS_FORK_EPOCH: 1536,
  // Heze
  HEZE_FORK_VERSION: b("0x90000000"),
  HEZE_FORK_EPOCH: Infinity,

  // Deposit contract
  // ---------------------------------------------------------------
  DEPOSIT_CHAIN_ID: 7091047534,
  DEPOSIT_NETWORK_ID: 7091047534,

  // Blob Scheduling
  // ---------------------------------------------------------------
  BLOB_SCHEDULE: [
    {
      EPOCH: 0,
      MAX_BLOBS_PER_BLOCK: 21,
    },
  ],

  // Gas Limit Scheduling
  // ---------------------------------------------------------------
  GAS_LIMIT_SCHEDULE: [
    {
      EPOCH: 1566,
      GAS_LIMIT: 200000000,
    },
  ],
};
