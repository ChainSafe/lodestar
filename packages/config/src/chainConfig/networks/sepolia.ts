import {fromHex as b} from "@lodestar/utils";
import {chainConfig as mainnet} from "../configs/mainnet.js";
import {ChainConfig} from "../types.js";

// Sepolia beacon chain config:
// https://github.com/eth-clients/sepolia/blob/main/metadata/config.yaml

export const sepoliaChainConfig: ChainConfig = {
  ...mainnet,

  CONFIG_NAME: "sepolia",

  // Genesis
  // ---------------------------------------------------------------
  MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: 1300,
  // # Sunday, June 19, 2022 2:00:00 PM +UTC
  MIN_GENESIS_TIME: 1655647200,
  GENESIS_FORK_VERSION: b("0x90000069"),
  GENESIS_DELAY: 86400,

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
  // Electra
  ELECTRA_FORK_VERSION: b("0x90000074"),
  ELECTRA_FORK_EPOCH: 222464,
  // Fulu
  FULU_FORK_VERSION: b("0x90000075"),
  FULU_FORK_EPOCH: 272640,
  // Gloas
  GLOAS_FORK_VERSION: b("0x90000076"),
  GLOAS_FORK_EPOCH: Infinity,

  // Deposit contract
  // ---------------------------------------------------------------
  DEPOSIT_CHAIN_ID: 11155111,
  DEPOSIT_NETWORK_ID: 11155111,
  DEPOSIT_CONTRACT_ADDRESS: b("0x7f02C3E3c98b133055B8B348B2Ac625669Ed295D"),

  // Blob Scheduling
  // ---------------------------------------------------------------
  BLOB_SCHEDULE: [
    {
      EPOCH: 274176,
      MAX_BLOBS_PER_BLOCK: 15,
    },
    {
      EPOCH: 275712,
      MAX_BLOBS_PER_BLOCK: 21,
    },
  ],
};
