/**
 * @module chain/genesis
 */

import BN from "bn.js";

import {
  BeaconBlock,
  BeaconBlockBody,
  BeaconBlockHeader,
  BeaconState,
  bytes32,
  Deposit,
  Eth1Data,
  number64,
  Hash,
} from "@chainsafe/eth2.0-types";

import {
  EMPTY_SIGNATURE,
  FAR_FUTURE_EPOCH,
  GENESIS_EPOCH,
  GENESIS_SLOT,
  GENESIS_START_SHARD,
  ZERO_HASH,
} from "@chainsafe/eth2.0-constants";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {getTemporaryBlockHeader, getActiveValidatorIndices, getCompactCommitteesRoot} from "../stateTransition/util";
import {hashTreeRoot} from "@chainsafe/ssz";
import {processDeposit} from "../stateTransition/block/operations";
import {bnMin} from "../../util/math";
import {createValue} from "../../util/createValue";

export function initializeBeaconStateFromEth1(
  config: IBeaconConfig,
  eth1BlockHash: Hash,
  eth1Timestamp: number64,
  deposits: Deposit[]): BeaconState {
  const state = getGenesisBeaconState(
    config,
    eth1Timestamp,
    {
      depositCount: deposits.length,
      depositRoot: undefined,
      blockHash: eth1BlockHash
    },
    getTemporaryBlockHeader(
      config,
      getEmptyBlock()
    )
  );

  // Process deposits
  const leaves = deposits.map((deposit) => deposit.data);
  deposits.forEach((deposit, index) => {
    const depositDataList = leaves.slice(0, index + 1);
    state.eth1Data.depositRoot = hashTreeRoot(depositDataList, config.types.DepositData);
    processDeposit(config, state, deposit);
  });

  // Process activations
  state.validators.forEach((validator, index) => {
    const balance = state.balances[index];
    validator.effectiveBalance = bnMin(
      balance.sub(balance.div(config.params.EFFECTIVE_BALANCE_INCREMENT)),
      config.params.MAX_EFFECTIVE_BALANCE
    );
    if(validator.effectiveBalance.eq(config.params.MAX_EFFECTIVE_BALANCE)) {
      validator.activationEligibilityEpoch = config.params.GENESIS_EPOCH;
      validator.activationEpoch = config.params.GENESIS_EPOCH;
    }
  });

  // Populate active_index_roots and compact_committees_roots
  const indices = getActiveValidatorIndices(state, config.params.GENESIS_EPOCH);
  const activeIndexRoot = hashTreeRoot(indices, config.types.ValidatorIndex);
  const committeeRoot = getCompactCommitteesRoot(config, state, config.params.GENESIS_EPOCH);
  for (let index = 0; index < config.params.EPOCHS_PER_HISTORICAL_VECTOR; index++) {
    state.activeIndexRoots[index] = activeIndexRoot;
    state.compactCommitteesRoots[index] = committeeRoot;
  }
  return state;
}

export function isValidGenesisState(config: IBeaconConfig, state: BeaconState) {
  if(state.genesisTime < config.params.MIN_GENESIS_TIME) {
    return false;
  }
  if(getActiveValidatorIndices(state, config.params.GENESIS_EPOCH).length < config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT) {
    return false;
  }
  return true;
}

/**
 * Generate the initial beacon chain state.
 */
export function getGenesisBeaconState(
  config: IBeaconConfig,
  genesisTime: number64,
  genesisEth1Data: Eth1Data,
  latestBlockHeader: BeaconBlockHeader
): BeaconState {

  return createValue(config.types.BeaconState, {
    // MISC
    slot: GENESIS_SLOT,
    genesisTime,
    fork: {
      previousVersion: config.params.GENESIS_FORK_VERSION,
      currentVersion: config.params.GENESIS_FORK_VERSION,
      epoch: GENESIS_EPOCH,
    },

    // Validator registry

    // Randomness and committees
    startShard: config.params.GENESIS_START_SHARD,

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
    latestBlockHeader: latestBlockHeader,

    // Ethereum 1.0 chain data
    eth1Data: genesisEth1Data,
  });
}

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
