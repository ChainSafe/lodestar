/**
 * @module chain/genesis
 */

import {TreeBacked, List} from "@chainsafe/ssz";
import {
  BeaconBlock,
  BeaconBlockBody,
  BeaconBlockHeader,
  BeaconState,
  Deposit,
  Eth1Data,
  Bytes32,
  Fork,
  SignedBeaconBlock,
  Root,
  DepositData,
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {
  EMPTY_SIGNATURE,
  GENESIS_SLOT,
  ZERO_HASH,
} from "../../constants";
import {
  computeEpochAtSlot,
  getActiveValidatorIndices,
  processDeposit,
} from "@chainsafe/lodestar-beacon-state-transition";
import {bigIntMin} from "@chainsafe/lodestar-utils";

/**
 * Apply eth1 block hash to state.
 * @param config IBeaconConfig
 * @param state BeaconState
 * @param eth1BlockHash eth1 block hash
 */
export function applyEth1BlockHash(config: IBeaconConfig, state: BeaconState, eth1BlockHash: Bytes32): void {
  state.eth1Data.blockHash = eth1BlockHash;
  state.randaoMixes = Array<Bytes32>(config.params.EPOCHS_PER_HISTORICAL_VECTOR).fill(eth1BlockHash);
}

/**
 * Apply eth1 block timestamp to state.
 * @param config IBeaconState
 * @param state BeaconState
 * @param eth1Timestamp eth1 block timestamp
 */
export function applyTimestamp(config: IBeaconConfig, state: BeaconState, eth1Timestamp: number): void {
  state.genesisTime =
    eth1Timestamp - eth1Timestamp % config.params.MIN_GENESIS_DELAY + 2 * config.params.MIN_GENESIS_DELAY;
}

/**
 * Apply deposits to state.
 * For spec test, fullDepositDataRootList is undefined.
 * For genesis builder, fullDepositDataRootList is full list of deposit data root from index 0.
 * @param config IBeaconConfig
 * @param state BeaconState
 * @param newDeposits new deposits
 * @param fullDepositDataRootList full list of deposit data root from index 0
 */
export function applyDeposits(
  config: IBeaconConfig,
  state: BeaconState,
  newDeposits: Deposit[],
  fullDepositDataRootList?: TreeBacked<List<Root>>
): void {

  const depositDataRootList: Root[] = [];
  if (fullDepositDataRootList) {
    for (let index = 0; index < state.eth1Data.depositCount; index++) {
      depositDataRootList.push(fullDepositDataRootList[index]);
    }
  }
  const depositDatas: DepositData[] = fullDepositDataRootList? null : newDeposits.map((deposit) => deposit.data);
  newDeposits.forEach((deposit, index) => {
    if (fullDepositDataRootList) {
      depositDataRootList.push(fullDepositDataRootList[index + depositDataRootList.length]);
      state.eth1Data.depositRoot = config.types.DepositDataRootList.hashTreeRoot(depositDataRootList);
    } else {
      const depositDataList = depositDatas.slice(0, index + 1);
      state.eth1Data.depositRoot = config.types.DepositDataRootList.hashTreeRoot(
        depositDataList.map((d) => config.types.DepositData.hashTreeRoot(d))
      );
    }
    state.eth1Data.depositCount += 1;
    processDeposit(config, state, deposit);
  });

  // Process activations
  state.validators.forEach((validator, index) => {
    const balance = state.balances[index];
    validator.effectiveBalance = bigIntMin(balance - (balance % config.params.EFFECTIVE_BALANCE_INCREMENT),
      config.params.MAX_EFFECTIVE_BALANCE);
    if(validator.effectiveBalance === config.params.MAX_EFFECTIVE_BALANCE) {
      validator.activationEligibilityEpoch = computeEpochAtSlot(config, GENESIS_SLOT);
      validator.activationEpoch = computeEpochAtSlot(config, GENESIS_SLOT);
    }
  });

  // Set genesis validators root for domain separation and chain versioning
  state.genesisValidatorsRoot = config.types.BeaconState.fields.validators.hashTreeRoot(state.validators);
}

export function isValidGenesisState(config: IBeaconConfig, state: BeaconState): boolean {
  if(state.genesisTime < config.params.MIN_GENESIS_TIME) {
    return false;
  }
  return getActiveValidatorIndices(state, computeEpochAtSlot(config, GENESIS_SLOT)).length
      >=
      config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT;
}

/**
 * Generate the initial beacon chain state.
 */
export function getGenesisBeaconState(
  config: IBeaconConfig,
  genesisEth1Data: Eth1Data,
  latestBlockHeader: BeaconBlockHeader
): TreeBacked<BeaconState> {
  // Seed RANDAO with Eth1 entropy
  const randaoMixes = Array<Bytes32>(config.params.EPOCHS_PER_HISTORICAL_VECTOR).fill(genesisEth1Data.blockHash);

  const state: BeaconState = config.types.BeaconState.tree.defaultValue();
  // MISC
  state.slot = GENESIS_SLOT;
  state.fork = {
    previousVersion: config.params.GENESIS_FORK_VERSION,
    currentVersion: config.params.GENESIS_FORK_VERSION,
    epoch: computeEpochAtSlot(config, GENESIS_SLOT),
  } as Fork;

  // Validator registry

  // Randomness and committees
  state.latestBlockHeader = latestBlockHeader;

  // Ethereum 1.0 chain data
  state.eth1Data = genesisEth1Data;
  state.randaoMixes = randaoMixes;

  return state as TreeBacked<BeaconState>;
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
export function getEmptySignedBlock(): SignedBeaconBlock {
  const block = getEmptyBlock();
  return {
    message: block,
    signature: Buffer.alloc(96),
  };
}

/**
 * Get an empty [[BeaconBlock]].
 */
export function getEmptyBlock(): BeaconBlock {
  return {
    slot: GENESIS_SLOT,
    proposerIndex: 0,
    parentRoot: ZERO_HASH,
    stateRoot: ZERO_HASH,
    body: getEmptyBlockBody(),
  };
}
