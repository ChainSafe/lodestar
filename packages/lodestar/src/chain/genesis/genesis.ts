/**
 * @module chain/genesis
 */

import {
  BeaconBlock,
  BeaconBlockBody,
  BeaconBlockHeader,
  BeaconState,
  Deposit,
  Eth1Data,
  Hash,
  number64,
} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {
  DEPOSIT_CONTRACT_TREE_DEPTH,
  EMPTY_SIGNATURE,
  GENESIS_EPOCH,
  GENESIS_SLOT,
  SECONDS_PER_DAY,
  ZERO_HASH,
} from "../../constants";
import {
  getActiveValidatorIndices,
  getTemporaryBlockHeader,
  processDeposit
} from "@chainsafe/eth2.0-state-transition";
import {hashTreeRoot} from "@chainsafe/ssz";

import {createValue} from "../../util/createValue";
import {bnMin} from "@chainsafe/eth2.0-utils";

export function initializeBeaconStateFromEth1(
  config: IBeaconConfig,
  eth1BlockHash: Hash,
  eth1Timestamp: number64,
  deposits: Deposit[]): BeaconState {
  const state = getGenesisBeaconState(
    config,
    eth1Timestamp - eth1Timestamp % SECONDS_PER_DAY + 2 * SECONDS_PER_DAY,
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
    state.eth1Data.depositRoot = hashTreeRoot(depositDataList, {
      elementType: config.types.DepositData,
      maxLength: Math.pow(2, DEPOSIT_CONTRACT_TREE_DEPTH),
    });
    processDeposit(config, state, deposit);
  });

  // Process activations
  state.validators.forEach((validator, index) => {
    const balance = state.balances[index];
    validator.effectiveBalance = bnMin(
      balance.sub(balance.mod(config.params.EFFECTIVE_BALANCE_INCREMENT)),
      config.params.MAX_EFFECTIVE_BALANCE
    );
    if(validator.effectiveBalance.eq(config.params.MAX_EFFECTIVE_BALANCE)) {
      validator.activationEligibilityEpoch = config.params.GENESIS_EPOCH;
      validator.activationEpoch = config.params.GENESIS_EPOCH;
    }
  });

  return state;
}

export function isValidGenesisState(config: IBeaconConfig, state: BeaconState): boolean {
  if(state.genesisTime < config.params.MIN_GENESIS_TIME) {
    return false;
  }
  return getActiveValidatorIndices(state, config.params.GENESIS_EPOCH).length
      >=
      config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT;

}

/**
 * Generate the initial beacon chain state.
 */
export function getGenesisBeaconState(
  config: IBeaconConfig,
  genesisTime: number64,
  genesisEth1Data: Partial<Eth1Data>,
  latestBlockHeader: BeaconBlockHeader
): BeaconState {
  // Seed RANDAO with Eth1 entropy
  const randaoMixes = Array<Hash>(config.params.EPOCHS_PER_HISTORICAL_VECTOR).fill(genesisEth1Data.blockHash);

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
    latestBlockHeader: latestBlockHeader,

    // Ethereum 1.0 chain data
    eth1Data: genesisEth1Data,
    randaoMixes,
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
