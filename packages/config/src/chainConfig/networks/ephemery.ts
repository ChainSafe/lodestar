import {fromHex as b} from "@lodestar/utils";
import {chainConfig as mainnet} from "../configs/mainnet.js";
import {ChainConfig} from "../types.js";

// Ephemery is a periodically-resetting testnet (EIP-6916). These values track the
// current iteration in ephemery-genesis values.env, pinned to iteration 164:
// https://github.com/ephemery-testnet/ephemery-genesis/blob/a4b5a2ee5c1c40e378edc92f2ccd9938cf9207d0/values.env
const baseChainConfig: ChainConfig = {
  ...mainnet,

  CONFIG_NAME: "ephemery",

  // Genesis
  // ---------------------------------------------------------------
  MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: 64,
  MIN_GENESIS_TIME: 1790276400,
  GENESIS_FORK_VERSION: b("0x1000101b"),
  GENESIS_DELAY: 600,

  // Forking
  // ---------------------------------------------------------------
  // Altair
  ALTAIR_FORK_VERSION: b("0x2000101b"),
  ALTAIR_FORK_EPOCH: 0,
  // Merge
  BELLATRIX_FORK_VERSION: b("0x3000101b"),
  BELLATRIX_FORK_EPOCH: 0,
  TERMINAL_TOTAL_DIFFICULTY: BigInt("0"),
  // Capella
  CAPELLA_FORK_VERSION: b("0x4000101b"),
  CAPELLA_FORK_EPOCH: 0,
  // Deneb
  DENEB_FORK_VERSION: b("0x5000101b"),
  DENEB_FORK_EPOCH: 0,
  // Electra
  ELECTRA_FORK_VERSION: b("0x6000101b"),
  ELECTRA_FORK_EPOCH: 0,
  // Fulu
  FULU_FORK_VERSION: b("0x7000101b"),
  FULU_FORK_EPOCH: 0,
  // Gloas
  GLOAS_FORK_VERSION: b("0x8000101b"),
  GLOAS_FORK_EPOCH: Infinity,

  // Deposit contract
  // ---------------------------------------------------------------
  DEPOSIT_CHAIN_ID: 39438164,
  DEPOSIT_NETWORK_ID: 39438164,

  ETH1_FOLLOW_DISTANCE: 12,

  // Blob Scheduling
  // ---------------------------------------------------------------
  BLOB_SCHEDULE: [
    {
      EPOCH: 2048,
      MAX_BLOBS_PER_BLOCK: 12,
    },
    {
      EPOCH: 4096,
      MAX_BLOBS_PER_BLOCK: 15,
    },
  ],
};

// values.env GENESIS_INTERVAL
const RESET_INTERVAL_SECONDS = 2419200;

/**
 * Resolve the ephemery config for the iteration active at `nowMs`, in whole seconds so
 * every process within an iteration agrees (#10160). values.env publishes the next
 * iteration ahead of activation, so `iterations` can be negative.
 */
export function getEphemeryChainConfig(nowMs: number = Date.now()): ChainConfig {
  const nowSeconds = Math.floor(nowMs / 1000);
  const iterations = Math.floor((nowSeconds - baseChainConfig.MIN_GENESIS_TIME) / RESET_INTERVAL_SECONDS);

  return {
    ...baseChainConfig,
    MIN_GENESIS_TIME: baseChainConfig.MIN_GENESIS_TIME + iterations * RESET_INTERVAL_SECONDS,
    DEPOSIT_CHAIN_ID: baseChainConfig.DEPOSIT_CHAIN_ID + iterations,
    DEPOSIT_NETWORK_ID: baseChainConfig.DEPOSIT_NETWORK_ID + iterations,
  };
}

export const ephemeryChainConfig: ChainConfig = getEphemeryChainConfig();
