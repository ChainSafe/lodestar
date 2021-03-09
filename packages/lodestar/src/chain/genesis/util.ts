/**
 * @module chain/genesis
 */

import {TreeBacked, List} from "@chainsafe/ssz";
import {Bytes32, Root, phase0} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {EMPTY_SIGNATURE, GENESIS_SLOT, ZERO_HASH} from "../../constants";
import {computeEpochAtSlot, getActiveValidatorIndices} from "@chainsafe/lodestar-beacon-state-transition";
import {processDeposit} from "@chainsafe/lodestar-beacon-state-transition/phase0";
import {bigIntMin} from "@chainsafe/lodestar-utils";

/**
 * Apply eth1 block hash to state.
 * @param config IBeaconConfig
 * @param state BeaconState
 * @param eth1BlockHash eth1 block hash
 */
export function applyEth1BlockHash(config: IBeaconConfig, state: phase0.BeaconState, eth1BlockHash: Bytes32): void {
  state.eth1Data.blockHash = eth1BlockHash;
  state.randaoMixes = Array<Bytes32>(config.params.EPOCHS_PER_HISTORICAL_VECTOR).fill(eth1BlockHash);
}

/**
 * Apply eth1 block timestamp to state.
 * @param config IBeaconState
 * @param state BeaconState
 * @param eth1Timestamp eth1 block timestamp
 */
export function applyTimestamp(
  config: IBeaconConfig,
  state: TreeBacked<phase0.BeaconState>,
  eth1Timestamp: number
): void {
  state.genesisTime = eth1Timestamp + config.params.GENESIS_DELAY;
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
  state: phase0.BeaconState,
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

  for (const [index, deposit] of newDeposits.entries()) {
    if (fullDepositDataRootList) {
      depositDataRootList.push(fullDepositDataRootList[index + initDepositCount]);
      state.eth1Data.depositRoot = config.types.phase0.DepositDataRootList.hashTreeRoot(
        depositDataRootList as List<Root>
      );
    } else if (depositDatas) {
      const depositDataList = depositDatas.slice(0, index + 1);
      state.eth1Data.depositRoot = config.types.phase0.DepositDataRootList.hashTreeRoot(
        depositDataList.map((d) => config.types.phase0.DepositData.hashTreeRoot(d)) as List<Root>
      );
    }

    state.eth1Data.depositCount += 1;
    processDeposit(config, state, deposit);
  }

  // Process activations
  state.validators.forEach((validator, index) => {
    const balance = state.balances[index];
    validator.effectiveBalance = bigIntMin(
      balance - (balance % config.params.EFFECTIVE_BALANCE_INCREMENT),
      config.params.MAX_EFFECTIVE_BALANCE
    );

    if (validator.effectiveBalance === config.params.MAX_EFFECTIVE_BALANCE) {
      validator.activationEligibilityEpoch = computeEpochAtSlot(config, GENESIS_SLOT);
      validator.activationEpoch = computeEpochAtSlot(config, GENESIS_SLOT);
    }
  });

  // Set genesis validators root for domain separation and chain versioning
  state.genesisValidatorsRoot = config.types.phase0.BeaconState.fields.validators.hashTreeRoot(state.validators);
}

/**
 *
 * This is used to either calculate genesis timestamp or estimate eth1 block forming genesis state.
 */
export function calculateStateTime(config: IBeaconConfig, eth1Timestamp: number): number {
  return eth1Timestamp + config.params.GENESIS_DELAY;
}

/**
 * Check if it's valid genesis state.
 * @param config
 * @param state
 */
export function isValidGenesisState(config: IBeaconConfig, state: phase0.BeaconState): boolean {
  return state.genesisTime >= config.params.MIN_GENESIS_TIME && isValidGenesisValidators(config, state);
}

/**
 * Check if it's valid genesis validators state.
 * @param config
 * @param state
 */
export function isValidGenesisValidators(config: IBeaconConfig, state: phase0.BeaconState): boolean {
  return (
    getActiveValidatorIndices(state, computeEpochAtSlot(config, GENESIS_SLOT)).length >=
    config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT
  );
}

/**
 * Generate the initial beacon chain state.
 */
export function getGenesisBeaconState(
  config: IBeaconConfig,
  genesisEth1Data: phase0.Eth1Data,
  latestBlockHeader: phase0.BeaconBlockHeader
): TreeBacked<phase0.BeaconState> {
  // Seed RANDAO with Eth1 entropy
  const randaoMixes = Array<Bytes32>(config.params.EPOCHS_PER_HISTORICAL_VECTOR).fill(genesisEth1Data.blockHash);

  const state: phase0.BeaconState = config.types.phase0.BeaconState.tree.defaultValue();
  // MISC
  state.slot = GENESIS_SLOT;
  state.fork = {
    previousVersion: config.params.GENESIS_FORK_VERSION,
    currentVersion: config.params.GENESIS_FORK_VERSION,
    epoch: computeEpochAtSlot(config, GENESIS_SLOT),
  } as phase0.Fork;

  // Validator registry

  // Randomness and committees
  state.latestBlockHeader = latestBlockHeader;

  // Ethereum 1.0 chain data
  state.eth1Data = genesisEth1Data;
  state.randaoMixes = randaoMixes;

  return state as TreeBacked<phase0.BeaconState>;
}

export function getEmptyBlockBody(): phase0.BeaconBlockBody {
  return {
    randaoReveal: EMPTY_SIGNATURE,
    eth1Data: {
      depositRoot: ZERO_HASH,
      depositCount: 0,
      blockHash: ZERO_HASH,
    },
    graffiti: ZERO_HASH,
    proposerSlashings: ([] as phase0.ProposerSlashing[]) as List<phase0.ProposerSlashing>,
    attesterSlashings: ([] as phase0.AttesterSlashing[]) as List<phase0.AttesterSlashing>,
    attestations: ([] as phase0.Attestation[]) as List<phase0.Attestation>,
    deposits: ([] as phase0.Deposit[]) as List<phase0.Deposit>,
    voluntaryExits: ([] as phase0.SignedVoluntaryExit[]) as List<phase0.SignedVoluntaryExit>,
  };
}

/**
 * Get an empty [[BeaconBlock]].
 */
export function getEmptySignedBlock(): phase0.SignedBeaconBlock {
  const block = getEmptyBlock();
  return {
    message: block,
    signature: Buffer.alloc(96),
  };
}

/**
 * Get an empty [[BeaconBlock]].
 */
export function getEmptyBlock(): phase0.BeaconBlock {
  return {
    slot: GENESIS_SLOT,
    proposerIndex: 0,
    parentRoot: ZERO_HASH,
    stateRoot: ZERO_HASH,
    body: getEmptyBlockBody(),
  };
}
