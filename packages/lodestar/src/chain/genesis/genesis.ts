/**
 * @module chain/genesis
 */

import {TreeBacked} from "@chainsafe/ssz";
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
  SignedBeaconBlock,
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
  getTemporaryBlockHeader,
  processDeposit,
} from "@chainsafe/lodestar-beacon-state-transition";
import {bigIntMin} from "@chainsafe/lodestar-utils";

export function initializeBeaconStateFromEth1(
  config: IBeaconConfig,
  eth1BlockHash: Bytes32,
  eth1Timestamp: Number64,
  deposits: Deposit[]): TreeBacked<BeaconState> {
  const state = getGenesisBeaconState(
    config,
    eth1Timestamp - eth1Timestamp % config.params.MIN_GENESIS_DELAY + 2 * config.params.MIN_GENESIS_DELAY,
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
      validator.activationEligibilityEpoch = computeEpochAtSlot(config, GENESIS_SLOT);
      validator.activationEpoch = computeEpochAtSlot(config, GENESIS_SLOT);
    }
  });

  // Set genesis validators root for domain separation and chain versioning
  state.genesisValidatorsRoot = config.types.BeaconState.fields.validators.hashTreeRoot(state.validators);

  return state as TreeBacked<BeaconState>;
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
    epoch: computeEpochAtSlot(config, GENESIS_SLOT),
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
