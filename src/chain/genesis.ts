/**
 * @module chain/genesis
 */

import BN from "bn.js";
import {hashTreeRoot} from "@chainsafe/ssz";

import {
  BeaconBlock,
  BeaconState,
  Deposit,
  Eth1Data,
  number64,
  BeaconBlockBody,
} from "../types";

import {
  EMPTY_SIGNATURE, 
  FAR_FUTURE_EPOCH,
  GENESIS_SLOT,
  GENESIS_EPOCH,
  GENESIS_START_SHARD,
  ZERO_HASH,
} from "../constants";
import {BeaconConfig} from "../config";

import {getActiveValidatorIndices, getTemporaryBlockHeader} from "./stateTransition/util";

import {processDeposit} from "./stateTransition/block/operations";


export function getEmptyBlockBody(): BeaconBlockBody {
  return {
    randaoReveal: EMPTY_SIGNATURE,
    eth1Data: {
      depositRoot: ZERO_HASH,
      depositCount: 0,
      blockHash: ZERO_HASH,
    },
    graffiti: ZERO_HASH,
    proposerSlashings: [],
    attesterSlashings: [],
    attestations: [],
    deposits: [],
    voluntaryExits: [],
    transfers: [],
  };
}

/**
 * Get an empty [[BeaconBlock]].
 */
export function getEmptyBlock(): BeaconBlock {
  return {
    slot: GENESIS_SLOT,
    parentRoot: ZERO_HASH,
    stateRoot: ZERO_HASH,
    body: getEmptyBlockBody(),
    signature: EMPTY_SIGNATURE,
  };
}

/**
 * Generate the initial beacon chain state.
 */
export function getGenesisBeaconState(
  config: BeaconConfig,
  genesisValidatorDeposits: Deposit[],
  genesisTime: number64,
  genesisEth1Data: Eth1Data,
): BeaconState {

  const state: BeaconState = {
    // MISC
    slot: GENESIS_SLOT,
    genesisTime,
    fork: {
      previousVersion: config.params.GENESIS_FORK_VERSION,
      currentVersion: config.params.GENESIS_FORK_VERSION,
      epoch: GENESIS_EPOCH,
    },

    // Validator registry
    validatorRegistry: [],
    balances: [],

    // Randomness and committees
    latestRandaoMixes: Array.from({length: config.params.LATEST_RANDAO_MIXES_LENGTH}, () => ZERO_HASH),
    latestStartShard: config.params.GENESIS_START_SHARD,

    // Finality
    previousEpochAttestations: [],
    currentEpochAttestations: [],
    previousJustifiedEpoch: GENESIS_EPOCH - 1,
    currentJustifiedEpoch: GENESIS_EPOCH,
    previousJustifiedRoot: ZERO_HASH,
    currentJustifiedRoot: ZERO_HASH,
    justificationBitfield: new BN(0),
    finalizedEpoch: GENESIS_EPOCH,
    finalizedRoot: ZERO_HASH,

    // Recent state
    currentCrosslinks: Array.from({length: config.params.SHARD_COUNT}, () => ({
      shard: GENESIS_START_SHARD,
      startEpoch: GENESIS_EPOCH,
      endEpoch: FAR_FUTURE_EPOCH,
      parentRoot: ZERO_HASH,
      dataRoot: ZERO_HASH,
    })),
    previousCrosslinks: Array.from({length: config.params.SHARD_COUNT}, () => ({
      shard: GENESIS_START_SHARD,
      startEpoch: GENESIS_EPOCH,
      endEpoch: FAR_FUTURE_EPOCH,
      parentRoot: ZERO_HASH,
      dataRoot: ZERO_HASH,
    })),
    latestBlockRoots: Array.from({length: config.params.SLOTS_PER_HISTORICAL_ROOT}, () => ZERO_HASH),
    latestStateRoots: Array.from({length: config.params.SLOTS_PER_HISTORICAL_ROOT}, () => ZERO_HASH),
    latestActiveIndexRoots: Array.from({length: config.params.LATEST_ACTIVE_INDEX_ROOTS_LENGTH}, () => ZERO_HASH),
    latestSlashedBalances: Array.from({length: config.params.LATEST_SLASHED_EXIT_LENGTH}, () => new BN(0)),
    latestBlockHeader: getTemporaryBlockHeader(config, getEmptyBlock()),
    historicalRoots: [],

    // Ethereum 1.0 chain data
    latestEth1Data: genesisEth1Data,
    eth1DataVotes: [],
    depositIndex: 0,
  };

  // Process genesis deposists
  genesisValidatorDeposits.forEach((deposit) =>
    processDeposit(config, state, deposit));

  // Process genesis activations
  state.validatorRegistry.forEach((validator) => {
    if (validator.effectiveBalance.gte(config.params.MAX_EFFECTIVE_BALANCE)) {
      validator.activationEligibilityEpoch = GENESIS_EPOCH;
      validator.activationEpoch = GENESIS_EPOCH;
    }
  });

  const genesisActiveIndexRoot =
    hashTreeRoot(getActiveValidatorIndices(state, GENESIS_EPOCH), [config.types.ValidatorIndex]);
  for (let i = 0; i < config.params.LATEST_ACTIVE_INDEX_ROOTS_LENGTH; i++) {
    state.latestActiveIndexRoots[i] = genesisActiveIndexRoot;
  }
  return state;
}
