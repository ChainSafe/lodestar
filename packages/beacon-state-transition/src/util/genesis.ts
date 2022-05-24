import {IBeaconConfig, IChainForkConfig} from "@chainsafe/lodestar-config";
import {
  EFFECTIVE_BALANCE_INCREMENT,
  EPOCHS_PER_HISTORICAL_VECTOR,
  ForkName,
  GENESIS_EPOCH,
  GENESIS_SLOT,
  MAX_EFFECTIVE_BALANCE,
} from "@chainsafe/lodestar-params";
import {Bytes32, phase0, Root, ssz, TimeSeconds} from "@chainsafe/lodestar-types";

import {processDeposit} from "../allForks/index.js";
import {CachedBeaconStateAllForks, BeaconStateAllForks} from "../types.js";
import {computeEpochAtSlot} from "./epoch.js";
import {getActiveValidatorIndices} from "./validator.js";
import {getTemporaryBlockHeader} from "./blockRoot.js";
import {CompositeViewDU, ListCompositeType} from "@chainsafe/ssz";
import {newFilledArray} from "./array.js";
import {getNextSyncCommittee} from "./syncCommittee.js";
import {createCachedBeaconState} from "../cache/stateCache.js";
import {EpochContextImmutableData} from "../cache/epochContext.js";

type DepositDataRootListType = ListCompositeType<typeof ssz.Root>;
type DepositDataRootViewDU = CompositeViewDU<DepositDataRootListType>;

// TODO: Refactor to work with non-phase0 genesis state

/**
 * Check if it's valid genesis state.
 * @param config
 * @param state
 */
export function isValidGenesisState(config: IChainForkConfig, state: BeaconStateAllForks): boolean {
  return state.genesisTime >= config.MIN_GENESIS_TIME && isValidGenesisValidators(config, state);
}

/**
 * Check if it's valid genesis validators state.
 * @param config
 * @param state
 */
export function isValidGenesisValidators(config: IChainForkConfig, state: BeaconStateAllForks): boolean {
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
  config: IChainForkConfig,
  genesisEth1Data: phase0.Eth1Data,
  latestBlockHeader: phase0.BeaconBlockHeader
): BeaconStateAllForks {
  // Seed RANDAO with Eth1 entropy
  const randaoMixes = newFilledArray(EPOCHS_PER_HISTORICAL_VECTOR, genesisEth1Data.blockHash);

  const beaconStateType = config.getForkTypes(GENESIS_SLOT).BeaconState;
  const state = beaconStateType.defaultViewDU();

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
  state.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: previousFork.version,
    currentVersion: version,
    epoch: computeEpochAtSlot(GENESIS_SLOT),
  });

  // Validator registry

  // Randomness and committees
  state.latestBlockHeader = ssz.phase0.BeaconBlockHeader.toViewDU(latestBlockHeader);

  // Ethereum 1.0 chain data
  state.eth1Data = ssz.phase0.Eth1Data.toViewDU(genesisEth1Data);
  state.randaoMixes = ssz.phase0.RandaoMixes.toViewDU(randaoMixes);

  return state;
}

/**
 * Apply eth1 block hash to state.
 * @param config IChainForkConfig
 * @param state BeaconState
 * @param eth1BlockHash eth1 block hash
 */
export function applyEth1BlockHash(state: CachedBeaconStateAllForks, eth1BlockHash: Bytes32): void {
  state.eth1Data.blockHash = eth1BlockHash;
  state.randaoMixes = ssz.phase0.RandaoMixes.toViewDU(newFilledArray(EPOCHS_PER_HISTORICAL_VECTOR, eth1BlockHash));
}

/**
 * Apply eth1 block timestamp to state.
 * @param config IBeaconState
 * @param state BeaconState
 * @param eth1Timestamp eth1 block timestamp
 */
export function applyTimestamp(
  config: IChainForkConfig,
  state: CachedBeaconStateAllForks,
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
  fullDepositDataRootList?: DepositDataRootViewDU
): {activatedValidatorCount: number} {
  const depositDataRootList: Root[] = [];

  const fullDepositDataRootArr = fullDepositDataRootList ? fullDepositDataRootList.getAllReadonlyValues() : null;

  if (fullDepositDataRootArr) {
    const depositCount = state.eth1Data.depositCount;
    for (let index = 0; index < depositCount; index++) {
      depositDataRootList.push(fullDepositDataRootArr[index]);
    }
  }

  const initDepositCount = depositDataRootList.length;
  const depositDatas = fullDepositDataRootList ? null : newDeposits.map((deposit) => deposit.data);
  const {DepositData, DepositDataRootList} = ssz.phase0;

  for (const [index, deposit] of newDeposits.entries()) {
    if (fullDepositDataRootArr) {
      depositDataRootList.push(fullDepositDataRootArr[index + initDepositCount]);
      state.eth1Data.depositRoot = DepositDataRootList.hashTreeRoot(depositDataRootList);
    } else if (depositDatas) {
      const depositDataList = depositDatas.slice(0, index + 1);
      state.eth1Data.depositRoot = DepositDataRootList.hashTreeRoot(
        depositDataList.map((d) => DepositData.hashTreeRoot(d))
      );
    }

    state.eth1Data.depositCount += 1;

    const forkName = config.getForkName(GENESIS_SLOT);
    processDeposit(forkName, state, deposit);
  }

  // Process activations
  const {epochCtx} = state;
  const balancesArr = state.balances.getAll();
  const validatorCount = state.validators.length;
  let activatedValidatorCount = 0;

  for (let i = 0; i < validatorCount; i++) {
    // For the case if effective balance has to be updated, get a mutable view
    const validator = state.validators.get(i);

    // Already active, ignore
    if (validator.activationEpoch === GENESIS_EPOCH) {
      continue;
    }

    const balance = balancesArr[i];
    const effectiveBalance = Math.min(balance - (balance % EFFECTIVE_BALANCE_INCREMENT), MAX_EFFECTIVE_BALANCE);

    validator.effectiveBalance = effectiveBalance;
    epochCtx.effectiveBalanceIncrementsSet(i, effectiveBalance);

    if (validator.effectiveBalance === MAX_EFFECTIVE_BALANCE) {
      validator.activationEligibilityEpoch = GENESIS_EPOCH;
      validator.activationEpoch = GENESIS_EPOCH;
      activatedValidatorCount++;
    }
  }

  // Set genesis validators root for domain separation and chain versioning
  // .hashTreeRoot() automatically commits()
  state.genesisValidatorsRoot = state.validators.hashTreeRoot();

  return {activatedValidatorCount};
}

/**
 * Mainly used for spec test.
 *
 * SLOW CODE - 🐢
 */
export function initializeBeaconStateFromEth1(
  config: IChainForkConfig,
  immutableData: EpochContextImmutableData,
  eth1BlockHash: Bytes32,
  eth1Timestamp: TimeSeconds,
  deposits: phase0.Deposit[],
  fullDepositDataRootList?: DepositDataRootViewDU,
  executionPayloadHeader = ssz.bellatrix.ExecutionPayloadHeader.defaultViewDU()
): CachedBeaconStateAllForks {
  const stateView = getGenesisBeaconState(
    // CachedBeaconcState is used for convinience only, we return BeaconStateAllForks anyway
    // so it's safe to do a cast here, we can't use get domain until we have genesisValidatorRoot
    config as IBeaconConfig,
    ssz.phase0.Eth1Data.defaultValue(),
    getTemporaryBlockHeader(config, config.getForkTypes(GENESIS_SLOT).BeaconBlock.defaultValue())
  );

  // We need a CachedBeaconState to run processDeposit() which uses various caches.
  // However at this point the state's syncCommittees are not known.
  // This function can be called by:
  // - 1. genesis spec tests: Don't care about the committee cache
  // - 2. genesis builder: Only supports starting from genesis at phase0 fork
  // - 3. interop state: Only supports starting from genesis at phase0 fork
  // So it's okay to skip syncing the sync committee cache here and expect it to be
  // populated latter when the altair fork happens for cases 2, 3.
  const state = createCachedBeaconState(stateView, immutableData, {skipSyncCommitteeCache: true});

  applyTimestamp(config, state, eth1Timestamp);
  applyEth1BlockHash(state, eth1BlockHash);

  // Process deposits
  applyDeposits(config, state, deposits, fullDepositDataRootList);

  // Commit before reading all validators in `getActiveValidatorIndices()`
  state.commit();
  const activeValidatorIndices = getActiveValidatorIndices(state, computeEpochAtSlot(GENESIS_SLOT));

  if (GENESIS_SLOT >= config.ALTAIR_FORK_EPOCH) {
    const {syncCommittee} = getNextSyncCommittee(
      state,
      activeValidatorIndices,
      state.epochCtx.effectiveBalanceIncrements
    );
    const stateAltair = state as CompositeViewDU<typeof ssz.altair.BeaconState>;
    stateAltair.fork.previousVersion = config.ALTAIR_FORK_VERSION;
    stateAltair.fork.currentVersion = config.ALTAIR_FORK_VERSION;
    stateAltair.currentSyncCommittee = ssz.altair.SyncCommittee.toViewDU(syncCommittee);
    stateAltair.nextSyncCommittee = ssz.altair.SyncCommittee.toViewDU(syncCommittee);
  }

  if (GENESIS_SLOT >= config.BELLATRIX_FORK_EPOCH) {
    const stateBellatrix = state as CompositeViewDU<typeof ssz.bellatrix.BeaconState>;
    stateBellatrix.fork.previousVersion = config.BELLATRIX_FORK_VERSION;
    stateBellatrix.fork.currentVersion = config.BELLATRIX_FORK_VERSION;
    stateBellatrix.latestExecutionPayloadHeader = executionPayloadHeader;
  }

  state.commit();

  return state;
}
