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
  Number64,
  Bytes32,
  Fork,
} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {
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
import {bigIntMin} from "@chainsafe/eth2.0-utils";

export function initializeBeaconStateFromEth1(
  config: IBeaconConfig,
  eth1BlockHash: Bytes32,
  eth1Timestamp: Number64,
  deposits: Deposit[]): BeaconState {
  const state = getGenesisBeaconState(
    config,
    eth1Timestamp - eth1Timestamp % SECONDS_PER_DAY + 2 * SECONDS_PER_DAY,
    {
      depositCount: deposits.length,
      depositRoot: new Uint8Array(32),
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
    state.eth1Data.depositRoot = config.types.DepositDataRootList.hashTreeRoot(
      depositDataList.map((d) => config.types.DepositData.hashTreeRoot(d))
    );
    processDeposit(config, state, deposit);
  });

  // Process activations
  state.validators.forEach((validator, index) => {
    const balance = state.balances[index];
    validator.effectiveBalance = bigIntMin(
      balance - (balance % config.params.EFFECTIVE_BALANCE_INCREMENT),
      config.params.MAX_EFFECTIVE_BALANCE
    );
    if(validator.effectiveBalance === config.params.MAX_EFFECTIVE_BALANCE) {
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
  genesisTime: Number64,
  genesisEth1Data: Eth1Data,
  latestBlockHeader: BeaconBlockHeader
): BeaconState {
  // Seed RANDAO with Eth1 entropy
  const randaoMixes = Array<Bytes32>(config.params.EPOCHS_PER_HISTORICAL_VECTOR).fill(genesisEth1Data.blockHash);

  const state: BeaconState = config.types.BeaconState.tree.defaultValue();
  // MISC
  state.slot = GENESIS_SLOT;
  state.genesisTime = genesisTime;
  state.fork = {
    previousVersion: config.params.GENESIS_FORK_VERSION,
    currentVersion: config.params.GENESIS_FORK_VERSION,
    epoch: GENESIS_EPOCH,
  } as Fork;

  // Validator registry

  // Randomness and committees
  state.latestBlockHeader = latestBlockHeader;

  // Ethereum 1.0 chain data
  state.eth1Data = genesisEth1Data;
  state.randaoMixes = randaoMixes;

  return state;
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
  };
}
