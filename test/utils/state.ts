import BN from "bn.js";

import { BeaconState, bytes32, Crosslink, Eth1Data, Fork, PendingAttestation, uint64, Validator, Slot, number64, Epoch, Shard, BeaconBlockHeader } from "../../src/types";
import {GENESIS_EPOCH, GENESIS_FORK_VERSION, GENESIS_SLOT, GENESIS_START_SHARD, LATEST_ACTIVE_INDEX_ROOTS_LENGTH,
  LATEST_RANDAO_MIXES_LENGTH, LATEST_SLASHED_EXIT_LENGTH, SHARD_COUNT, ZERO_HASH, SLOTS_PER_HISTORICAL_ROOT} from "../../src/constants";
import { intToBytes } from "../../src/util/bytes";
import {randBetween, randBetweenBN} from "./misc";
import {generateValidators} from "./validator";


/**
 * Copy of BeaconState, but all fields are marked optional to allow for swapping out variables as needed.
 */
interface TestBeaconState {
  // Misc
  slot?: Slot;
  genesisTime?: number64;
  fork?: Fork; // For versioning hard forks

  // Validator registry
  validatorRegistry?: Validator[];
  balances?: uint64[];

  // Randomness and committees
  latestRandaoMixes?: bytes32[];
  latestStartShard?: Shard;

  // Finality
  previousEpochAttestations?: PendingAttestation[];
  currentEpochAttestations?: PendingAttestation[];
  previousJustifiedEpoch?: Epoch;
  currentJustifiedEpoch?: Epoch;
  previousJustifiedRoot?: bytes32;
  currentJustifiedRoot?: bytes32;
  justificationBitfield?: uint64;
  finalizedEpoch?: Epoch;
  finalizedRoot?: bytes32;

  // Recent state
  latestCrosslinks?: Crosslink[];
  latestBlockRoots?: bytes32[];
  latestStateRoots?: bytes32[];
  latestActiveIndexRoots?: bytes32[];
  latestSlashedBalances?: uint64[]; // Balances penalized at every withdrawal period
  latestBlockHeader?: BeaconBlockHeader;
  historicalRoots?: bytes32[];

  // Ethereum 1.0 deposit root
  latestEth1Data?: Eth1Data;
  eth1DataVotes?: Eth1Data[];
  depositIndex?: number64;
}

/**
 * Generate beaconState, by default it will use the initial state defined when the `ChainStart` log is emitted.
 * NOTE: All fields can be overridden through `opts`.
 * @param {TestBeaconState} opts
 * @returns {BeaconState}
 */
export function generateState(opts?: TestBeaconState): BeaconState {
  const initialCrosslinkRecord: Crosslink = {
    epoch: GENESIS_EPOCH,
    previousCrosslinkRoot: ZERO_HASH,
    crosslinkDataRoot: ZERO_HASH,
  };

  return {
    // MISC
    slot: GENESIS_SLOT,
    genesisTime: Math.floor(Date.now() / 1000),
    fork: {
      previousVersion: GENESIS_FORK_VERSION,
      currentVersion: GENESIS_FORK_VERSION,
      epoch: GENESIS_EPOCH,
    },
    // Validator registry
    validatorRegistry: [],
    balances: [],

    // Randomness and committees
    latestRandaoMixes: Array.from({length: LATEST_RANDAO_MIXES_LENGTH}, () => ZERO_HASH),
    latestStartShard: GENESIS_START_SHARD,

    // Finality
    previousEpochAttestations: [],
    currentEpochAttestations: [],
    previousJustifiedEpoch: GENESIS_EPOCH,
    currentJustifiedEpoch: GENESIS_EPOCH,
    previousJustifiedRoot: Buffer.alloc(32),
    currentJustifiedRoot: Buffer.alloc(32),
    justificationBitfield: new BN(0),
    finalizedEpoch: GENESIS_EPOCH,
    finalizedRoot: Buffer.alloc(32),

    // Recent state
    currentCrosslinks: Array.from({length: SHARD_COUNT}, () => initialCrosslinkRecord),
    previousCrosslinks: Array.from({length: SHARD_COUNT}, () => initialCrosslinkRecord),
    latestBlockRoots: Array.from({length: SLOTS_PER_HISTORICAL_ROOT}, () => ZERO_HASH),
    latestStateRoots: Array.from({length: SLOTS_PER_HISTORICAL_ROOT}, () => ZERO_HASH),
    latestActiveIndexRoots: Array.from({length: LATEST_ACTIVE_INDEX_ROOTS_LENGTH}, () => ZERO_HASH),
    latestSlashedBalances: Array.from({length: LATEST_SLASHED_EXIT_LENGTH}, () => new BN(0)),
    latestBlockHeader: {
      slot: 0,
      previousBlockRoot: Buffer.alloc(32),
      stateRoot: Buffer.alloc(32),
      blockBodyRoot: Buffer.alloc(32),
      signature: Buffer.alloc(96),
    },
    historicalRoots: [],

    // PoW receipt root
    latestEth1Data: {
      depositRoot: Buffer.alloc(32),
      blockHash: Buffer.alloc(32),
      depositCount: 0,
    },
    eth1DataVotes: [],
    depositIndex: 0,
    ...opts,
  };
}

/**
 * Generates a random beacon state, with the option to override on or more parameters.
 * TODO: Should check to make sure that if a field is changed the appropriate conditions are met, BeaconState should be valid.
 * @param {TestBeaconState} opts
 * @returns {BeaconState}
 */
export function generateRandomState(opts?: TestBeaconState): BeaconState {
  const initialCrosslinkRecord: Crosslink = {
    epoch: randBetween(0, 1000),
    previousCrosslinkRoot: ZERO_HASH,
    crosslinkDataRoot: ZERO_HASH,
  };

  const validatorNum: number = randBetween(0, 1000);

  return {
    // MISC
    slot: randBetween(0, 1000),
    genesisTime: Math.floor(Date.now() / 1000),
    fork: {
      previousVersion: intToBytes(randBetween(0, 1000), 4),
      currentVersion: intToBytes(randBetween(0, 1000), 4),
      epoch: randBetween(0, 1000),
    },
    // Validator registry
    validatorRegistry: generateValidators(validatorNum),
    balances: Array.from({length: validatorNum}, () => randBetweenBN(0, 1000)),

    // Randomness and committees
    latestRandaoMixes: Array.from({length: randBetween(0, 1000)}, () => Buffer.alloc(32)),
    latestStartShard: randBetween(0, 1000),

    // Finality
    previousEpochAttestations: [],
    currentEpochAttestations: [],
    previousJustifiedEpoch: randBetween(0, 1000),
    currentJustifiedEpoch: randBetween(0, 1000),
    previousJustifiedRoot: Buffer.alloc(32),
    currentJustifiedRoot: Buffer.alloc(32),
    justificationBitfield: randBetweenBN(0, 1000),
    finalizedEpoch: randBetween(0, 1000),
    finalizedRoot: Buffer.alloc(32),

    currentCrosslinks: Array.from({length: SHARD_COUNT}, () => initialCrosslinkRecord),
    previousCrosslinks: Array.from({length: SHARD_COUNT}, () => initialCrosslinkRecord),
    latestBlockRoots: Array.from({length: SLOTS_PER_HISTORICAL_ROOT}, () => Buffer.alloc(32)),
    latestStateRoots: Array.from({length: SLOTS_PER_HISTORICAL_ROOT}, () => Buffer.alloc(32)),
    latestActiveIndexRoots: Array.from({length: LATEST_ACTIVE_INDEX_ROOTS_LENGTH}, () => Buffer.alloc(32)),
    latestSlashedBalances: Array.from({length: LATEST_SLASHED_EXIT_LENGTH}, () => randBetweenBN(0, 1000)),
    latestBlockHeader: {
      slot: 0,
      previousBlockRoot: Buffer.alloc(32),
      stateRoot: Buffer.alloc(32),
      blockBodyRoot: Buffer.alloc(32),
      signature: Buffer.alloc(96),
    },
    historicalRoots: Array.from({length: randBetween(0, 1000)}, () => Buffer.alloc(32)),

    // PoW receipt root
    latestEth1Data: {
      depositRoot: Buffer.alloc(32),
      blockHash: Buffer.alloc(32),
      depositCount: 0,
    },
    eth1DataVotes: [],
    depositIndex: 0,
    ...opts,
  };
}
