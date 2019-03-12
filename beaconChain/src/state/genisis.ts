import BN from "bn.js";
import { hashTreeRoot } from "@chainsafesystems/ssz";

import {
  BeaconState,
  Crosslink,
  Deposit,
  Eth1Data,
  int,
  ValidatorIndex,
} from "../types";

import {
  GENESIS_EPOCH,
  GENESIS_FORK_VERSION,
  GENESIS_SLOT,
  GENESIS_START_SHARD,
  LATEST_ACTIVE_INDEX_ROOTS_LENGTH,
  LATEST_BLOCK_ROOTS_LENGTH,
  LATEST_RANDAO_MIXES_LENGTH,
  LATEST_SLASHED_EXIT_LENGTH,
  MAX_DEPOSIT_AMOUNT,
  SHARD_COUNT,
  ZERO_HASH,
} from "../constants";

import {
  generateSeed,
  getActiveValidatorIndices,
  getEffectiveBalance,
  processDeposit,
} from "../helpers/stateTransitionHelpers";

import {
  activateValidator,
} from "../helpers/validatorStatus";

/**
 * Generate the initial beacon chain state.
 * @param {Deposit[]} initialValidatorDeposits
 * @param {int} genesisTime
 * @param {Eth1Data} latestEth1Data
 * @returns {BeaconState}
 */
export function getInitialBeaconState(
  genesisValidatorDeposits: Deposit[],
  genesisTime: int,
  latestEth1Data: Eth1Data): BeaconState {

  const initialCrosslinkRecord: Crosslink = {
    epoch: GENESIS_EPOCH,
    shardBlockRoot: ZERO_HASH,
  };

  const state: BeaconState = {
    // MISC
    slot: GENESIS_SLOT,
    genesisTime: new BN(genesisTime),
    fork: {
      previousVersion: GENESIS_FORK_VERSION,
      currentVersion: GENESIS_FORK_VERSION,
      epoch: GENESIS_EPOCH,
    },
    // Validator registry
    validatorRegistry: [],
    validatorBalances: [],
    validatorRegistryUpdateEpoch: GENESIS_EPOCH,

    // Randomness and committees
    latestRandaoMixes: Array.from({length: LATEST_RANDAO_MIXES_LENGTH}, () => ZERO_HASH),
    previousShufflingStartShard: GENESIS_START_SHARD,
    currentShufflingStartShard: GENESIS_START_SHARD,
    previousShufflingEpoch: GENESIS_EPOCH,
    currentShufflingEpoch: GENESIS_EPOCH,
    previousShufflingSeed: ZERO_HASH,
    currentShufflingSeed: ZERO_HASH,

    // Finality
    previousJustifiedEpoch: GENESIS_EPOCH,
    justifiedEpoch: GENESIS_EPOCH,
    justificationBitfield: new BN(0),
    finalizedEpoch: GENESIS_EPOCH,

    // Recent state
    latestCrosslinks: Array.from({length: SHARD_COUNT}, () => initialCrosslinkRecord),
    latestBlockRoots: Array.from({length: LATEST_BLOCK_ROOTS_LENGTH}, () => ZERO_HASH),
    latestActiveIndexRoots: Array.from({length: LATEST_ACTIVE_INDEX_ROOTS_LENGTH}, () => ZERO_HASH),
    latestSlashedBalances: Array.from({length: LATEST_SLASHED_EXIT_LENGTH}, () => new BN(0)),
    latestAttestations: [],
    batchedBlockRoots: [],

    // PoW receipt root
    latestEth1Data,
    eth1DataVotes: [],
    depositIndex: new BN(genesisValidatorDeposits.length),
  };

  // Process initial deposists
  genesisValidatorDeposits.forEach((deposit) => {
    processDeposit(
      state,
      deposit.depositData.depositInput.pubkey,
      deposit.depositData.amount,
      deposit.depositData.depositInput.proofOfPossession,
      deposit.depositData.depositInput.withdrawalCredentials,
    );
  });

  // Process genesis activations
  // TODO For loop is stubbed, should not cast new BN(i)
  for (let i = 0; i < state.validatorRegistry.length; i ++) {
    if (getEffectiveBalance(state, new BN(i)).gten(MAX_DEPOSIT_AMOUNT)) {
      activateValidator(state, new BN(i), true);
    }
  }

  const genesisActiveIndexRoot = hashTreeRoot(getActiveValidatorIndices(state.validatorRegistry, GENESIS_EPOCH), [ValidatorIndex]);
  for (let index = 0; index < LATEST_ACTIVE_INDEX_ROOTS_LENGTH; index++) {
    state.latestActiveIndexRoots[index] = genesisActiveIndexRoot;
  }
  state.currentShufflingSeed = generateSeed(state, GENESIS_EPOCH);
  return state;
}
