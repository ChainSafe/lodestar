import {List, TreeBacked} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {
  EFFECTIVE_BALANCE_INCREMENT,
  EPOCHS_PER_HISTORICAL_VECTOR,
  ForkName,
  GENESIS_SLOT,
  MAX_EFFECTIVE_BALANCE,
} from "@chainsafe/lodestar-params";
import {allForks, altair, Bytes32, Number64, phase0, Root, ssz} from "@chainsafe/lodestar-types";
import {bigIntMin} from "@chainsafe/lodestar-utils";

import {processDeposit as phase0ProcessDeposit} from "../naive/phase0";
import {processDeposit as altairProcessDeposit} from "../naive/altair";
import {computeEpochAtSlot} from "./epoch";
import {getActiveValidatorIndices} from "./validator";
import {getTemporaryBlockHeader} from "./blockRoot";
import {getNextSyncCommittee} from "../altair/state_accessor";

// TODO: Refactor to work with non-phase0 genesis state

/**
 * Check if it's valid genesis state.
 * @param config
 * @param state
 */
export function isValidGenesisState(config: IBeaconConfig, state: allForks.BeaconState): boolean {
  return state.genesisTime >= config.MIN_GENESIS_TIME && isValidGenesisValidators(config, state);
}

/**
 * Check if it's valid genesis validators state.
 * @param config
 * @param state
 */
export function isValidGenesisValidators(config: IBeaconConfig, state: allForks.BeaconState): boolean {
  return (
    getActiveValidatorIndices(state, computeEpochAtSlot(GENESIS_SLOT)).length >=
    config.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT
  );
}

/**
 * Generate the initial beacon chain state.
 */
export function getGenesisBeaconState(
  config: IBeaconConfig,
  genesisEth1Data: phase0.Eth1Data,
  latestBlockHeader: phase0.BeaconBlockHeader
): TreeBacked<allForks.BeaconState> {
  // Seed RANDAO with Eth1 entropy
  const randaoMixes = Array<Bytes32>(EPOCHS_PER_HISTORICAL_VECTOR).fill(genesisEth1Data.blockHash);

  const state: allForks.BeaconState = config.getForkTypes(GENESIS_SLOT).BeaconState.defaultTreeBacked();
  // MISC
  state.slot = GENESIS_SLOT;
  const version = config.getForkVersion(GENESIS_SLOT);
  const forkName = config.getForkName(GENESIS_SLOT);
  const allForkNames = Object.keys(config.forks) as ForkName[];
  const forkIndex = allForkNames.findIndex((item) => item === forkName);
  const previousForkIndex = Math.max(0, forkIndex - 1);
  const previousForkName = allForkNames[previousForkIndex];
  const previousFork = config.forks[previousForkName];
  // the altair genesis spec test requires previous version to be phase0 although ALTAIR_FORK_EPOCH=0
  state.fork = {
    previousVersion: previousFork.version,
    currentVersion: version,
    epoch: computeEpochAtSlot(GENESIS_SLOT),
  } as phase0.Fork;

  // Validator registry

  // Randomness and committees
  state.latestBlockHeader = latestBlockHeader;

  // Ethereum 1.0 chain data
  state.eth1Data = genesisEth1Data;
  state.randaoMixes = randaoMixes;
  return state as TreeBacked<allForks.BeaconState>;
}

/**
 * Apply eth1 block hash to state.
 * @param config IBeaconConfig
 * @param state BeaconState
 * @param eth1BlockHash eth1 block hash
 */
export function applyEth1BlockHash(state: allForks.BeaconState, eth1BlockHash: Bytes32): void {
  state.eth1Data.blockHash = eth1BlockHash;
  state.randaoMixes = Array<Bytes32>(EPOCHS_PER_HISTORICAL_VECTOR).fill(eth1BlockHash);
}

/**
 * Apply eth1 block timestamp to state.
 * @param config IBeaconState
 * @param state BeaconState
 * @param eth1Timestamp eth1 block timestamp
 */
export function applyTimestamp(
  config: IBeaconConfig,
  state: TreeBacked<allForks.BeaconState>,
  eth1Timestamp: number
): void {
  state.genesisTime = eth1Timestamp + config.GENESIS_DELAY;
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
  state: allForks.BeaconState,
  newDeposits: phase0.Deposit[],
  fullDepositDataRootList?: TreeBacked<List<Root>>
): void {
  const depositDataRootList: Root[] = [];
  if (fullDepositDataRootList) {
    for (let index = 0; index < state.eth1Data.depositCount; index++) {
      depositDataRootList.push(fullDepositDataRootList[index]);
    }
  }

  const initDepositCount = depositDataRootList.length;
  const depositDatas = fullDepositDataRootList ? null : newDeposits.map((deposit) => deposit.data);
  const {DepositData, DepositDataRootList} = ssz.phase0;

  for (const [index, deposit] of newDeposits.entries()) {
    if (fullDepositDataRootList) {
      depositDataRootList.push(fullDepositDataRootList[index + initDepositCount]);
      state.eth1Data.depositRoot = DepositDataRootList.hashTreeRoot(depositDataRootList as List<Root>);
    } else if (depositDatas) {
      const depositDataList = depositDatas.slice(0, index + 1);
      state.eth1Data.depositRoot = DepositDataRootList.hashTreeRoot(
        depositDataList.map((d) => DepositData.hashTreeRoot(d)) as List<Root>
      );
    }

    state.eth1Data.depositCount += 1;

    const forkName = config.getForkName(GENESIS_SLOT);
    if (forkName == ForkName.phase0) {
      phase0ProcessDeposit(config, state, deposit);
    } else {
      altairProcessDeposit(config, state as altair.BeaconState, deposit);
    }
  }

  // Process activations
  // validators are edited, so we're not iterating (read-only) through the validators
  const validatorLength = state.validators.length;
  for (let index = 0; index < validatorLength; index++) {
    const validator = state.validators[index];
    const balance = state.balances[index];
    validator.effectiveBalance = bigIntMin(balance - (balance % EFFECTIVE_BALANCE_INCREMENT), MAX_EFFECTIVE_BALANCE);

    if (validator.effectiveBalance === MAX_EFFECTIVE_BALANCE) {
      validator.activationEligibilityEpoch = computeEpochAtSlot(GENESIS_SLOT);
      validator.activationEpoch = computeEpochAtSlot(GENESIS_SLOT);
    }
  }

  // Set genesis validators root for domain separation and chain versioning
  state.genesisValidatorsRoot = config
    .getForkTypes(state.slot)
    .BeaconState.fields.validators.hashTreeRoot(state.validators);
}

/**
 * Mainly used for spec test.
 * @param config
 * @param eth1BlockHash
 * @param eth1Timestamp
 * @param deposits
 */
export function initializeBeaconStateFromEth1(
  config: IBeaconConfig,
  eth1BlockHash: Bytes32,
  eth1Timestamp: Number64,
  deposits: phase0.Deposit[]
): TreeBacked<allForks.BeaconState> {
  const state = getGenesisBeaconState(
    config,
    ssz.phase0.Eth1Data.defaultValue(),
    getTemporaryBlockHeader(config, config.getForkTypes(GENESIS_SLOT).BeaconBlock.defaultValue())
  );

  applyTimestamp(config, state, eth1Timestamp);
  applyEth1BlockHash(state, eth1BlockHash);

  // Process deposits
  applyDeposits(config, state, deposits);

  if (config.getForkName(GENESIS_SLOT) === ForkName.altair) {
    const syncCommittees = getNextSyncCommittee(state);
    const altairState = state as TreeBacked<altair.BeaconState>;
    altairState.currentSyncCommittee = syncCommittees;
    altairState.nextSyncCommittee = syncCommittees;
    return altairState as TreeBacked<allForks.BeaconState>;
  } else {
    return state;
  }
}
