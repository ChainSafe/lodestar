import {config as minimalConfig} from "@chainsafe/lodestar-config/default";
import {
  EPOCHS_PER_HISTORICAL_VECTOR,
  EPOCHS_PER_SLASHINGS_VECTOR,
  GENESIS_EPOCH,
  GENESIS_SLOT,
  SLOTS_PER_HISTORICAL_ROOT,
} from "@chainsafe/lodestar-params";
import {phase0, ssz} from "@chainsafe/lodestar-types";
import {config} from "@chainsafe/lodestar-config/default";

import {ZERO_HASH} from "../../src/constants";
import {newZeroedBigIntArray} from "../../src/util";

import {generateEmptyBlock} from "./block";
import {
  BeaconStatePhase0,
  CachedBeaconStateAllForks,
  BeaconStateAllForks,
  createCachedBeaconState,
  PubkeyIndexMap,
} from "../../src";
import {createIBeaconConfig, IChainForkConfig} from "@chainsafe/lodestar-config";
import {BeaconStateCache} from "../../src/cache/stateCache";
import {EpochContextOpts} from "../../src/cache/epochContext";

/**
 * Copy of BeaconState, but all fields are marked optional to allow for swapping out variables as needed.
 */
type TestBeaconState = Partial<phase0.BeaconState>;

/**
 * Generate beaconState, by default it will use the initial state defined when the `ChainStart` log is emitted.
 * NOTE: All fields can be overridden through `opts`.
 * @param {TestBeaconState} opts
 * @returns {BeaconState}
 */
export function generateState(opts?: TestBeaconState): BeaconStatePhase0 {
  return ssz.phase0.BeaconState.toViewDU({
    genesisTime: Math.floor(Date.now() / 1000),
    genesisValidatorsRoot: ZERO_HASH,
    slot: GENESIS_SLOT,
    fork: {
      previousVersion: config.GENESIS_FORK_VERSION,
      currentVersion: config.GENESIS_FORK_VERSION,
      epoch: GENESIS_EPOCH,
    },
    latestBlockHeader: {
      slot: 0,
      proposerIndex: 0,
      parentRoot: Buffer.alloc(32),
      stateRoot: Buffer.alloc(32),
      bodyRoot: ssz.phase0.BeaconBlockBody.hashTreeRoot(generateEmptyBlock().body),
    },
    blockRoots: Array.from({length: SLOTS_PER_HISTORICAL_ROOT}, () => ZERO_HASH),
    stateRoots: Array.from({length: SLOTS_PER_HISTORICAL_ROOT}, () => ZERO_HASH),
    historicalRoots: [],
    eth1Data: {
      depositRoot: Buffer.alloc(32),
      blockHash: Buffer.alloc(32),
      depositCount: 0,
    },
    eth1DataVotes: [],
    eth1DepositIndex: 0,
    validators: [],
    balances: [],
    randaoMixes: Array.from({length: EPOCHS_PER_HISTORICAL_VECTOR}, () => ZERO_HASH),
    slashings: newZeroedBigIntArray(EPOCHS_PER_SLASHINGS_VECTOR),
    previousEpochAttestations: [],
    currentEpochAttestations: [],
    justificationBits: ssz.phase0.JustificationBits.defaultValue(),
    previousJustifiedCheckpoint: {
      epoch: GENESIS_EPOCH,
      root: ZERO_HASH,
    },
    currentJustifiedCheckpoint: {
      epoch: GENESIS_EPOCH,
      root: ZERO_HASH,
    },
    finalizedCheckpoint: {
      epoch: GENESIS_EPOCH,
      root: ZERO_HASH,
    },
    ...opts,
  });
}

export function generateCachedState(
  config: IChainForkConfig = minimalConfig,
  opts: TestBeaconState = {}
): CachedBeaconStateAllForks {
  const state = generateState(opts);
  return createCachedBeaconState(state, {
    config: createIBeaconConfig(config, state.genesisValidatorsRoot),
    // This is a test state, there's no need to have a global shared cache of keys
    pubkey2index: new PubkeyIndexMap(),
    index2pubkey: [],
  });
}

export function createCachedBeaconStateTest<T extends BeaconStateAllForks>(
  state: T,
  configCustom: IChainForkConfig = config,
  opts?: EpochContextOpts
): T & BeaconStateCache {
  return createCachedBeaconState<T>(
    state,
    {
      config: createIBeaconConfig(configCustom, state.genesisValidatorsRoot),
      // This is a test state, there's no need to have a global shared cache of keys
      pubkey2index: new PubkeyIndexMap(),
      index2pubkey: [],
    },
    opts
  );
}
