import {fromHex as b} from "@lodestar/utils";
import {chainConfig as mainnet} from "../configs/mainnet.js";
import {ChainConfig} from "../types.js";

// Hoodi beacon chain config:
// https://github.com/eth-clients/hoodi/blob/main/metadata/config.yaml

export const hoodiChainConfig: ChainConfig = {
  ...mainnet,

  CONFIG_NAME: "hoodi",

  // Genesis
  // ---------------------------------------------------------------
  // 2025-Mar-17 12:00:00 PM UTC
  MIN_GENESIS_TIME: 1742212800,
  GENESIS_DELAY: 600,
  GENESIS_FORK_VERSION: b("0x10000910"),

  // Forking
  // ---------------------------------------------------------------
  // # Altair
  ALTAIR_FORK_VERSION: b("0x20000910"),
  ALTAIR_FORK_EPOCH: 0,
  // # Merge
  BELLATRIX_FORK_VERSION: b("0x30000910"),
  BELLATRIX_FORK_EPOCH: 0,
  TERMINAL_TOTAL_DIFFICULTY: BigInt("0"),
  // Capella
  CAPELLA_FORK_VERSION: b("0x40000910"),
  CAPELLA_FORK_EPOCH: 0,
  // Deneb
  DENEB_FORK_VERSION: b("0x50000910"),
  DENEB_FORK_EPOCH: 0,
  // Electra
  ELECTRA_FORK_VERSION: b("0x60000910"),
  ELECTRA_FORK_EPOCH: 2048,
  // Fulu
  FULU_FORK_VERSION: b("0x70000910"),
  FULU_FORK_EPOCH: Infinity,

  // Time parameters
  // ---------------------------------------------------------------
  // 12 (update from older mainnet default of 14)
  SECONDS_PER_ETH1_BLOCK: 12,

  // Deposit contract
  // ---------------------------------------------------------------
  DEPOSIT_CHAIN_ID: 560048,
  DEPOSIT_NETWORK_ID: 560048,

  // Blob Scheduling
  // ---------------------------------------------------------------
  BLOB_SCHEDULE: [
    // Deneb
    {EPOCH: 0, MAX_BLOBS_PER_BLOCK: 6},
    // Electra
    {EPOCH: 2048, MAX_BLOBS_PER_BLOCK: 9},
  ],
};
