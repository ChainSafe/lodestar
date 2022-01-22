import {List, Vector} from "@chainsafe/ssz";
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
import {CachedBeaconStateAllForks, createCachedBeaconState} from "../../src";
import {IChainForkConfig} from "@chainsafe/lodestar-config";

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
export function generateState(opts?: TestBeaconState): phase0.BeaconState {
  return {
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
    historicalRoots: ([] as Vector<number>[]) as List<Vector<number>>,
    eth1Data: {
      depositRoot: Buffer.alloc(32),
      blockHash: Buffer.alloc(32),
      depositCount: 0,
    },
    eth1DataVotes: ([] as phase0.Eth1Data[]) as List<phase0.Eth1Data>,
    eth1DepositIndex: 0,
    validators: ([] as phase0.Validator[]) as List<phase0.Validator>,
    balances: ([] as number[]) as List<number>,
    randaoMixes: Array.from({length: EPOCHS_PER_HISTORICAL_VECTOR}, () => ZERO_HASH),
    slashings: newZeroedBigIntArray(EPOCHS_PER_SLASHINGS_VECTOR),
    previousEpochAttestations: ([] as phase0.PendingAttestation[]) as List<phase0.PendingAttestation>,
    currentEpochAttestations: ([] as phase0.PendingAttestation[]) as List<phase0.PendingAttestation>,
    justificationBits: [false, false, false, false],
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
  };
}

export function generateCachedState(
  config: IChainForkConfig = minimalConfig,
  opts: TestBeaconState = {}
): CachedBeaconStateAllForks {
  const state = generateState(opts);
  return createCachedBeaconState(config, config.getForkTypes(state.slot).BeaconState.createTreeBackedFromStruct(state));
}
