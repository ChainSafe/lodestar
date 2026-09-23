import {fromHex as b} from "@lodestar/utils";
import {chainConfig as mainnet} from "../configs/mainnet.js";
import {ChainConfig} from "../types.js";

// Ephemery dynamic beacon chain config:
// https://github.com/ephemery-testnet/ephemery-genesis/blob/master/cl-config.yaml
//
// Ephemery specification:
// https://eips.ethereum.org/EIPS/eip-6916

// Base config for the ephemery iteration currently published in
// https://github.com/ephemery-testnet/ephemery-genesis/blob/master/values.env
// (iteration 164: GENESIS_TIMESTAMP=1790276400, CHAIN_ID=39438164, GENESIS_DELAY=600).
// The network periodically resets; `getEphemeryChainConfig` rolls these values
// forward from this base so a node started in a later iteration still derives the
// correct values without requiring a Lodestar release.
const baseChainConfig: ChainConfig = {
  ...mainnet,

  CONFIG_NAME: "ephemery",

  // Genesis
  // ---------------------------------------------------------------
  MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: 64,
  // Thu Sep 24 2026 19:00:00 GMT+0000
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

// Ephemery reset interval (28 days) in seconds, from ephemery-genesis values.env
// `GENESIS_INTERVAL`:
// https://github.com/ephemery-testnet/ephemery-genesis/blob/master/values.env
const RESET_INTERVAL_SECONDS = 2419200;

/**
 * Ephemery periodically resets its genesis. Each reset advances `MIN_GENESIS_TIME`
 * by one reset interval and increments the deposit chain/network id by one.
 *
 * Derive the config for the iteration active at `nowMs` from the bundled base
 * iteration. All processes started within the same iteration compute identical
 * whole-second values, regardless of when in the iteration they start (see #10160).
 */
export function getEphemeryChainConfig(nowMs: number = Date.now()): ChainConfig {
  const nowSeconds = Math.floor(nowMs / 1000);
  const iterations = Math.max(0, Math.floor((nowSeconds - baseChainConfig.MIN_GENESIS_TIME) / RESET_INTERVAL_SECONDS));

  return {
    ...baseChainConfig,
    MIN_GENESIS_TIME: baseChainConfig.MIN_GENESIS_TIME + iterations * RESET_INTERVAL_SECONDS,
    DEPOSIT_CHAIN_ID: baseChainConfig.DEPOSIT_CHAIN_ID + iterations,
    DEPOSIT_NETWORK_ID: baseChainConfig.DEPOSIT_NETWORK_ID + iterations,
  };
}

export const ephemeryChainConfig: ChainConfig = getEphemeryChainConfig();
