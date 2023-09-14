/* eslint-disable @typescript-eslint/naming-convention */
import {fromHexString as b} from "@chainsafe/ssz";
import {PresetName} from "@lodestar/params";
import {ChainConfig} from "../types.js";

export const chainConfig: ChainConfig = {
  // Extends the minimal preset
  PRESET_BASE: PresetName.minimal,
  CONFIG_NAME: "minimal",

  // Transition
  // 2**256-2**10 for testing minimal network
  TERMINAL_TOTAL_DIFFICULTY: BigInt("115792089237316195423570985008687907853269984665640564039457584007913129638912"),
  TERMINAL_BLOCK_HASH: b("0x0000000000000000000000000000000000000000000000000000000000000000"),
  TERMINAL_BLOCK_HASH_ACTIVATION_EPOCH: Infinity,

  // Genesis
  // ---------------------------------------------------------------
  // [customized]
  MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: 64,
  // Jan 3, 2020
  MIN_GENESIS_TIME: 1578009600,
  // Highest byte set to 0x01 to avoid collisions with mainnet versioning
  GENESIS_FORK_VERSION: b("0x00000001"),
  // [customized] Faster to spin up testnets, but does not give validator reasonable warning time for genesis
  GENESIS_DELAY: 300,

  // Forking
  // ---------------------------------------------------------------
  // Values provided for illustrative purposes.
  // Individual tests/testnets may set different values.

  // Altair
  ALTAIR_FORK_VERSION: b("0x01000001"),
  ALTAIR_FORK_EPOCH: 74240, // Oct 27, 2021, 10:56:23am UTC
  // Bellatrix
  BELLATRIX_FORK_VERSION: b("0x02000001"),
  BELLATRIX_FORK_EPOCH: Infinity,
  // Capella
  CAPELLA_FORK_VERSION: b("0x03000001"),
  CAPELLA_FORK_EPOCH: Infinity,
  // Deneb
  DENEB_FORK_VERSION: b("0x04000001"),
  DENEB_FORK_EPOCH: Infinity,

  // Time parameters
  // ---------------------------------------------------------------
  // [customized] Faster for testing purposes
  SECONDS_PER_SLOT: 6,
  // 14 (estimate from Eth1 mainnet)
  SECONDS_PER_ETH1_BLOCK: 14,
  // 2**8 (= 256) epochs
  MIN_VALIDATOR_WITHDRAWABILITY_DELAY: 256,
  // [customized] higher frequency of committee turnover and faster time to acceptable voluntary exit
  SHARD_COMMITTEE_PERIOD: 64,
  // [customized] process deposits more quickly, but insecure
  ETH1_FOLLOW_DISTANCE: 16,

  // Validator cycle
  // ---------------------------------------------------------------
  // 2**2 (= 4)
  INACTIVITY_SCORE_BIAS: 4,
  // 2**4 (= 16)
  INACTIVITY_SCORE_RECOVERY_RATE: 16,
  // 2**4 * 10**9 (= 16,000,000,000) Gwei
  EJECTION_BALANCE: 16000000000,
  // 2**2 (= 4)
  MIN_PER_EPOCH_CHURN_LIMIT: 4,
  MAX_PER_EPOCH_CHURN_LIMIT: 8,
  // [customized] scale queue churn at much lower validator counts for testing
  CHURN_LIMIT_QUOTIENT: 32,
  PROPOSER_SCORE_BOOST: 40,

  // Deposit contract
  // ---------------------------------------------------------------
  // Ethereum Goerli testnet
  DEPOSIT_CHAIN_ID: 5,
  DEPOSIT_NETWORK_ID: 5,
  // Configured on a per testnet basis
  DEPOSIT_CONTRACT_ADDRESS: b("0x1234567890123456789012345678901234567890"),
};
