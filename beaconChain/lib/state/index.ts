import {
  BeaconState, BLSPubkey, BLSSignature, Bytes32, Crosslink, Deposit, DepositInput, Eth1Data, Gwei,
  Validator,
  ValidatorIndex,
} from "../../types";
import {
  ZERO_HASH, LATEST_RANDAO_MIXES_LENGTH, SHARD_COUNT,
  LATEST_BLOCK_ROOTS_LENGTH, EMPTY_SIGNATURE,
  WHISTLEBLOWER_REWARD_QUOTIENT, GENESIS_SLOT, GENESIS_FORK_VERSION,
  GENESIS_START_SHARD, LATEST_PENALIZED_EXIT_LENGTH, FAR_FUTURE_EPOCH, GENESIS_EPOCH,
  MAX_DEPOSIT_AMOUNT, LATEST_INDEX_ROOTS_LENGTH
} from "../../constants/constants";
import {
  generateSeed,
  getActiveValidatorIndices,
  getBeaconProposerIndex, getCurrentEpoch, getEffectiveBalance,
  getEntryExitEffectEpoch
} from "../../helpers/stateTransitionHelpers";
import {StatusFlags} from "../../constants/enums";

type int = number;

// Stubbed functions from SSZ
function hashTreeRoot(x: any): Bytes32 {
  return new Uint8Array(2);
}

/**
 * Generate the initial beacon chain state.
 * @param {Deposit[]} initialValidatorDeposits
 * @param {int} genesisTime
 * @param {Eth1Data} latestEth1Data
 * @returns {BeaconState}
 */
export function getInitialBeaconState(
  initialValidatorDeposits: Deposit[],
  genesisTime: int,
  latestEth1Data: Eth1Data): BeaconState {

  const initialCrosslinkRecord: Crosslink = {
      epoch: GENESIS_EPOCH,
      shardBlockRoot: ZERO_HASH
  };

  const state: BeaconState = {
      // MISC
      slot: GENESIS_SLOT,
      genesisTime: genesisTime,
      fork: {
          previousVersion: GENESIS_FORK_VERSION,
          currentVersion: GENESIS_FORK_VERSION,
          epoch: GENESIS_EPOCH
      },
      // Validator registry
      validatorRegistry: [],
      validatorBalances: [],
      validatorRegistryUpdateEpoch: GENESIS_EPOCH,

      // Randomness and committees
      latestRandaoMixes: Array.from({length: LATEST_RANDAO_MIXES_LENGTH}, () => ZERO_HASH),
      previousEpochStartShard: GENESIS_START_SHARD,
      currentEpochStartShard: GENESIS_START_SHARD,
      previousCalculationEpoch: GENESIS_EPOCH,
      currentCalculationEpoch: GENESIS_EPOCH,
      previousEpochSeed: ZERO_HASH,
      currentEpochSeed: ZERO_HASH,

      // Finality
      previousJustifiedEpoch: GENESIS_EPOCH,
      justifiedEpoch: GENESIS_EPOCH,
      justificationBitfield: 0,
      finalizedEpoch: GENESIS_EPOCH,

      // Recent state
      latestCrosslinks: Array.from({length: SHARD_COUNT}, () => initialCrosslinkRecord),
      latestBlockRoots: Array.from({length: LATEST_BLOCK_ROOTS_LENGTH}, () => ZERO_HASH),
      latestIndexRoots: Array.from({length: LATEST_INDEX_ROOTS_LENGTH}, () => ZERO_HASH),
      latestPenalizedBalances: Array.from({length: LATEST_PENALIZED_EXIT_LENGTH}, () => 0),
      latestAttestations: [],
      batchedBlockRoots: [],

      // PoW receipt root
      latestEth1Data: latestEth1Data,
      eth1DataVotes: [],
  };

  // Process initial deposists
  initialValidatorDeposits.forEach(deposit => {
      const validatorIndex = processDeposit(
        state,
        deposit.depositData.depositInput.pubkey,
        deposit.depositData.amount,
        deposit.depositData.depositInput.proofOfPossession,
        deposit.depositData.depositInput.withdrawalCredentials,
      );
  });

  // Process initial activations
  for (let i: ValidatorIndex = 0; i < state.validatorRegistry.length; i ++) {
    if (getEffectiveBalance(state, i) >= MAX_DEPOSIT_AMOUNT) {
      activateValidator(state, i, true);
    }
  }

  const genesisActiveIndexRoot = hashTreeRoot(getActiveValidatorIndices(state.validatorRegistry, GENESIS_EPOCH));
  for (let index: number; index < LATEST_INDEX_ROOTS_LENGTH; index++) {
    state.latestIndexRoots[index] = genesisActiveIndexRoot;
  }
  state.currentEpochSeed = generateSeed(state, GENESIS_EPOCH);
  return state;
}

/**
 * Process a deposit from eth1.x to eth2.
 * @param {BeaconState} state
 * @param {BLSPubkey} pubkey
 * @param {Gwei} amount
 * @param {BLSSignature} proofOfPossession
 * @param {Bytes32} withdrawalCredentials
 */
function processDeposit(
  state: BeaconState,
  pubkey: BLSPubkey,
  amount: Gwei,
  proofOfPossession: BLSSignature,
  withdrawalCredentials: Bytes32): void {
    // Validate the given proofOfPossession
    if (!validateProofOfPossession(state, pubkey, proofOfPossession, withdrawalCredentials)) {throw new Error("")};

    const validatorPubkeys = state.validatorRegistry.map(v => { return v.pubkey });

    if (!validatorPubkeys.includes(pubkey)) {
      // Add new validator
      const validator: Validator = {
        pubkey: pubkey,
        withdrawalCredentials: withdrawalCredentials,
        activationEpoch: FAR_FUTURE_EPOCH,
        exitEpoch: FAR_FUTURE_EPOCH,
        withdrawalEpoch: FAR_FUTURE_EPOCH,
        penalizedEpoch: FAR_FUTURE_EPOCH,
        statusFlags: 0,
      };

      // Note: In phase 2 registry indices that have been withdrawn for a long time will be recycled.
      state.validatorRegistry.push(validator);
      state.validatorBalances.push(amount);
    } else {
    // Increase balance by deposit amount
      const index = validatorPubkeys.indexOf(pubkey);
      if (state.validatorRegistry[index].withdrawalCredentials === withdrawalCredentials) throw new Error("Deposit already made!")
      state.validatorBalances[index] += amount;
    }
}

/**
 * Validate a eth1 deposit
 * @param {BeaconState} state
 * @param {BLSPubkey} pubkey
 * @param {BLSSignature} proofOfPossession
 * @param {Bytes32} withdrawalCredentials
 * @returns {boolean}
 */
function validateProofOfPossession(
  state: BeaconState,
  pubkey: BLSPubkey,
  proofOfPossession: BLSSignature,
  withdrawalCredentials: Bytes32): boolean {
    const proofOfPossessionData: DepositInput = {
        pubkey: pubkey,
        withdrawalCredentials: withdrawalCredentials,
        proofOfPossession: EMPTY_SIGNATURE
    };
    // Stubbed until BLS is a dependency
    // return bls_verify(
    //   pubkey=pubkey,
    //   message=hash_tree_root(proofOfPossessionData),
    //   signature=proofOfPossession,
    //   domain=getDomain(
    //       state.fork,
    //       getCurrentEpoch(state),
    //       DOMAIN_DEPOSIT,
    //   )
    return true;
}

/**
 * Activate a validator given an index.
 * @param {BeaconState} state
 * @param {ValidatorIndex} index
 * @param {boolean} isGenesis
 */
function activateValidator(state: BeaconState, index: ValidatorIndex, isGenesis: boolean): void {
    const validator: Validator = state.validatorRegistry[index];
    validator.activationEpoch = isGenesis ? GENESIS_EPOCH : getEntryExitEffectEpoch(getCurrentEpoch(state));
}

/**
 * Initiate exit for the validator with the given index.
 * Note: that this function mutates state.
 * @param {BeaconState} state
 * @param {int} index
 */
function initiateValidatorExit(state: BeaconState, index: ValidatorIndex): void {
    const validator = state.validatorRegistry[index];
    if (!validator.statusFlags) {
        validator.statusFlags = StatusFlags.INTIATED_EXIT;
    }
}

/**
 * Process a validator exit
 * @param {BeaconState} state
 * @param {int} index
 */
function exitValidator(state: BeaconState, index: ValidatorIndex): void {
  const validator = state.validatorRegistry[index];

  // The following updates only occur if not previous exited
  if (validator.exitEpoch <= getEntryExitEffectEpoch(getCurrentEpoch(state))) {
      return;
  }

  validator.exitEpoch = getEntryExitEffectEpoch(getCurrentEpoch(state));
}

/**
 * Penalize the validator of the given index.
 * Note that this function mutates state.
 * @param {BeaconState} state
 * @param {ValidatorIndex} index
 */
function penalizeValidator(state: BeaconState, index: ValidatorIndex): void {
    exitValidator(state, index);
    const validator = state.validatorRegistry[index];
    state.latestPenalizedBalances[getCurrentEpoch(state) % LATEST_PENALIZED_EXIT_LENGTH] += getEffectiveBalance(state, index);

    const whistleblowerIndex = getBeaconProposerIndex(state, state.slot);
    const whistleblowerReward = Math.floor(getEffectiveBalance(state, index) / WHISTLEBLOWER_REWARD_QUOTIENT);
    state.validatorBalances[whistleblowerIndex] += whistleblowerReward;
    state.validatorBalances[index] -= whistleblowerReward;
    validator.penalizedEpoch = getCurrentEpoch(state);
}

/**
 * Set the validator with the given index with WITHDRAWABLE flag.
 * Note that this function mutates state.
 * @param {BeaconState} state
 * @param {ValidatorIndex} index
 */
function prepareValidatorForWithdrawal(state: BeaconState, index: ValidatorIndex): void {
  const validator = state.validatorRegistry[index];
  if (!validator.statusFlags) {
    validator.statusFlags = StatusFlags.WITHDRAWABLE;
  }
}
