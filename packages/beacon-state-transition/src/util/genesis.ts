import {List, TreeBacked} from "@chainsafe/ssz";
import {IBeaconConfig, IChainForkConfig} from "@chainsafe/lodestar-config";
import {
  EFFECTIVE_BALANCE_INCREMENT,
  EPOCHS_PER_HISTORICAL_VECTOR,
  ForkName,
  GENESIS_EPOCH,
  GENESIS_SLOT,
  MAX_EFFECTIVE_BALANCE,
} from "@chainsafe/lodestar-params";
import {
  allForks,
  altair,
  Bytes32,
  bellatrix,
  Number64,
  phase0,
  Root,
  ssz,
  ValidatorIndex,
} from "@chainsafe/lodestar-types";

import {computeEpochAtSlot} from "./epoch";
import {getActiveValidatorIndices} from "./validator";
import {getTemporaryBlockHeader} from "./blockRoot";
import {getNextSyncCommittee} from "../util/syncCommittee";
import {processDeposit} from "../allForks";
import {createCachedBeaconState} from "../cache/cachedBeaconState";
import {CachedBeaconStateAllForks} from "../types";

// TODO: Refactor to work with non-phase0 genesis state

/**
 * Check if it's valid genesis state.
 * @param config
 * @param state
 */
export function isValidGenesisState(config: IChainForkConfig, state: allForks.BeaconState): boolean {
  return state.genesisTime >= config.MIN_GENESIS_TIME && isValidGenesisValidators(config, state);
}

/**
 * Check if it's valid genesis validators state.
 * @param config
 * @param state
 */
export function isValidGenesisValidators(config: IChainForkConfig, state: allForks.BeaconState): boolean {
  return (
    getActiveValidatorIndices(state, computeEpochAtSlot(GENESIS_SLOT)).length >=
    config.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT
  );
}

/**
 * Generate the initial beacon chain state.
 *
 * SLOW CODE - 🐢
 */
export function getGenesisBeaconState(
  config: IBeaconConfig,
  genesisEth1Data: phase0.Eth1Data,
  latestBlockHeader: phase0.BeaconBlockHeader
): CachedBeaconStateAllForks {
  // Seed RANDAO with Eth1 entropy
  const randaoMixes = Array<Bytes32>(EPOCHS_PER_HISTORICAL_VECTOR).fill(genesisEth1Data.blockHash);

  const state = config.getForkTypes(GENESIS_SLOT).BeaconState.defaultTreeBacked();
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

  // We need a CachedBeaconState to run processDeposit() which uses various caches.
  // However at this point the state's syncCommittees are not known.
  // This function can be called by:
  // - 1. genesis spec tests: Don't care about the committee cache
  // - 2. genesis builder: Only supports starting from genesis at phase0 fork
  // - 3. interop state: Only supports starting from genesis at phase0 fork
  // So it's okay to skip syncing the sync committee cache here and expect it to be
  // populated latter when the altair fork happens for cases 2, 3.
  return createCachedBeaconState(config, state, {skipSyncCommitteeCache: true});
}

/**
 * Apply eth1 block hash to state.
 * @param config IChainForkConfig
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
  config: IChainForkConfig,
  state: TreeBacked<allForks.BeaconState>,
  eth1Timestamp: number
): void {
  state.genesisTime = eth1Timestamp + config.GENESIS_DELAY;
}

/**
 * Apply deposits to state.
 * For spec test, fullDepositDataRootList is undefined.
 * For genesis builder, fullDepositDataRootList is full list of deposit data root from index 0.
 *
 * SLOW CODE - 🐢
 *
 * @param config IChainForkConfig
 * @param state BeaconState
 * @param newDeposits new deposits
 * @param fullDepositDataRootList full list of deposit data root from index 0
 * @returns active validator indices
 */
export function applyDeposits(
  config: IChainForkConfig,
  state: CachedBeaconStateAllForks,
  newDeposits: phase0.Deposit[],
  fullDepositDataRootList?: TreeBacked<List<Root>>
): ValidatorIndex[] {
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
    processDeposit(forkName, state, deposit);
  }

  const activeValidatorIndices: ValidatorIndex[] = [];
  // Process activations
  // validators are edited, so we're not iterating (read-only) through the validators
  const validatorLength = state.validators.length;
  for (let index = 0; index < validatorLength; index++) {
    const validator = state.validators[index];
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const balance = state.balanceList.get(index)!;
    const effectiveBalance = Math.min(balance - (balance % EFFECTIVE_BALANCE_INCREMENT), MAX_EFFECTIVE_BALANCE);
    validator.effectiveBalance = effectiveBalance;
    state.effectiveBalanceIncrementsSet(index, effectiveBalance);

    if (validator.effectiveBalance === MAX_EFFECTIVE_BALANCE) {
      validator.activationEligibilityEpoch = GENESIS_EPOCH;
      validator.activationEpoch = GENESIS_EPOCH;
      activeValidatorIndices.push(index);
    }
    // If state is a CachedBeaconState<> validator has to be re-assigned manually
    state.validators[index] = validator;
  }

  // Set genesis validators root for domain separation and chain versioning
  state.genesisValidatorsRoot = config
    .getForkTypes(state.slot)
    .BeaconState.fields.validators.hashTreeRoot(state.validators);
  return activeValidatorIndices;
}

/**
 * Mainly used for spec test.
 *
 * SLOW CODE - 🐢
 *
 * @param config
 * @param eth1BlockHash
 * @param eth1Timestamp
 * @param deposits
 */
export function initializeBeaconStateFromEth1(
  config: IChainForkConfig,
  eth1BlockHash: Bytes32,
  eth1Timestamp: Number64,
  deposits: phase0.Deposit[],
  fullDepositDataRootList?: TreeBacked<List<Root>>,
  executionPayloadHeader = ssz.bellatrix.ExecutionPayloadHeader.defaultTreeBacked()
): TreeBacked<allForks.BeaconState> {
  const state = getGenesisBeaconState(
    // CachedBeaconcState is used for convinience only, we return TreeBacked<allForks.BeaconState> anyway
    // so it's safe to do a cast here, we can't use get domain until we have genesisValidatorRoot
    config as IBeaconConfig,
    ssz.phase0.Eth1Data.defaultValue(),
    getTemporaryBlockHeader(config, config.getForkTypes(GENESIS_SLOT).BeaconBlock.defaultValue())
  );

  applyTimestamp(config, state, eth1Timestamp);
  applyEth1BlockHash(state, eth1BlockHash);

  // Process deposits
  const activeValidatorIndices = applyDeposits(config, state, deposits, fullDepositDataRootList);

  if (GENESIS_SLOT >= config.ALTAIR_FORK_EPOCH) {
    const syncCommittees = getNextSyncCommittee(state, activeValidatorIndices, state.effectiveBalanceIncrements);
    const stateAltair = state as TreeBacked<altair.BeaconState>;
    stateAltair.fork.previousVersion = config.ALTAIR_FORK_VERSION;
    stateAltair.fork.currentVersion = config.ALTAIR_FORK_VERSION;
    stateAltair.currentSyncCommittee = syncCommittees;
    stateAltair.nextSyncCommittee = syncCommittees;
  }

  if (GENESIS_SLOT >= config.BELLATRIX_FORK_EPOCH) {
    const stateBellatrix = state as TreeBacked<bellatrix.BeaconState>;
    stateBellatrix.fork.previousVersion = config.BELLATRIX_FORK_VERSION;
    stateBellatrix.fork.currentVersion = config.BELLATRIX_FORK_VERSION;
    stateBellatrix.latestExecutionPayloadHeader = executionPayloadHeader;
  }

  return state;
}
