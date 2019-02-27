import assert from "assert";
import BN from "bn.js";

import {
  BeaconState,
  BLSPubkey,
  BLSSignature,
  Bytes32,
  Crosslink,
  Deposit,
  DepositInput,
  Eth1Data,
  Gwei,
  int,
  uint64,
  Validator,
  ValidatorIndex,
} from "../types";

import {
  EMPTY_SIGNATURE, FAR_FUTURE_EPOCH, GENESIS_EPOCH, GENESIS_FORK_VERSION, GENESIS_SLOT, GENESIS_START_SHARD,
  INITIATED_EXIT, LATEST_ACTIVE_INDEX_ROOTS_LENGTH, LATEST_BLOCK_ROOTS_LENGTH, LATEST_RANDAO_MIXES_LENGTH,
  LATEST_SLASHED_EXIT_LENGTH, MAX_DEPOSIT_AMOUNT, SHARD_COUNT, WHISTLEBLOWER_REWARD_QUOTIENT, ZERO_HASH,
} from "../constants";

import {
  generateSeed,
  getActiveValidatorIndices,
  getBeaconProposerIndex, getCurrentEpoch, getEffectiveBalance,
  getEntryExitEffectEpoch,
} from "../helpers/stateTransitionHelpers";

import {
  activateValidator,
} from "../helpers/validatorStatus";


// Stubbed functions from SSZ
export function hashTreeRoot(x: any): Bytes32 {
  return Buffer.alloc(2);
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
  genesisTime: uint64,
  latestEth1Data: Eth1Data): BeaconState {

  const initialCrosslinkRecord: Crosslink = {
      epoch: GENESIS_EPOCH,
      shardBlockRoot: ZERO_HASH,
  };

  const state: BeaconState = {
      // MISC
      slot: GENESIS_SLOT,
      genesisTime,
      fork: {
          previousVersion: GENESIS_FORK_VERSION,
          currentVersion: GENESIS_FORK_VERSION,
          epoch: GENESIS_EPOCH,
      },
      // Validator registry
      validatorRegistry: [],
      validatorBalances: [],
      validatorRegistryUpdateEpoch: GENESIS_EPOCH,

      // Randomness and committees
      latestRandaoMixes: Array.from({length: LATEST_RANDAO_MIXES_LENGTH}, () => ZERO_HASH),
      previousShufflingStartShard: GENESIS_START_SHARD,
      currentShufflingStartShard: GENESIS_START_SHARD,
      previousShufflingEpoch: GENESIS_EPOCH,
      currentShufflingEpoch: GENESIS_EPOCH,
      previousShufflingSeed: ZERO_HASH,
      currentShufflingSeed: ZERO_HASH,

      // Finality
      previousJustifiedEpoch: GENESIS_EPOCH,
      justifiedEpoch: GENESIS_EPOCH,
      justificationBitfield: new BN(0),
      finalizedEpoch: GENESIS_EPOCH,

      // Recent state
      latestCrosslinks: Array.from({length: SHARD_COUNT}, () => initialCrosslinkRecord),
      latestBlockRoots: Array.from({length: LATEST_BLOCK_ROOTS_LENGTH}, () => ZERO_HASH),
      latestActiveIndexRoots: Array.from({length: LATEST_ACTIVE_INDEX_ROOTS_LENGTH}, () => ZERO_HASH),
      latestSlashedBalances: Array.from({length: LATEST_SLASHED_EXIT_LENGTH}, () => new BN(0)),
      latestAttestations: [],
      batchedBlockRoots: [],

      // PoW receipt root
      latestEth1Data,
      eth1DataVotes: [],
      depositIndex: new BN(0),
  };

  // Process initial deposists
  initialValidatorDeposits.forEach((deposit) => {
      const validatorIndex = processDeposit(
        state,
        deposit.depositData.depositInput.pubkey,
        deposit.depositData.amount,
        deposit.depositData.depositInput.proofOfPossession,
        deposit.depositData.depositInput.withdrawalCredentials,
      );
  });

  // Process initial activations
  for (let i: ValidatorIndex = new BN(0); i.ltn(state.validatorRegistry.length); i = i.add(new BN(1))) {
    // TODO: Unsafe usage of toNumber on i
    if (getEffectiveBalance(state, i) >= MAX_DEPOSIT_AMOUNT) {
      activateValidator(state, i, true);
    }
  }

  const genesisActiveIndexRoot = hashTreeRoot(getActiveValidatorIndices(state.validatorRegistry, GENESIS_EPOCH));
  for (let index: number; index < LATEST_ACTIVE_INDEX_ROOTS_LENGTH; index++) {
    state.latestActiveIndexRoots[index] = genesisActiveIndexRoot;
  }
  state.currentShufflingSeed = generateSeed(state, GENESIS_EPOCH);
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
export function processDeposit(
  state: BeaconState,
  pubkey: BLSPubkey,
  amount: Gwei,
  proofOfPossession: BLSSignature,
  withdrawalCredentials: Bytes32): void {
    // Validate the given proofOfPossession
    assert(validateProofOfPossession(state, pubkey, proofOfPossession, withdrawalCredentials));

    const validatorPubkeys = state.validatorRegistry.map((v) => v.pubkey);

    if (!validatorPubkeys.includes(pubkey)) {
      // Add new validator
      const validator: Validator = {
        pubkey,
        withdrawalCredentials,
        activationEpoch: new BN(FAR_FUTURE_EPOCH),
        exitEpoch: new BN(FAR_FUTURE_EPOCH),
        withdrawalEpoch: new BN(FAR_FUTURE_EPOCH),
        slashedEpoch: new BN(FAR_FUTURE_EPOCH),
        statusFlags: new BN(0),
      };

      // Note: In phase 2 registry indices that have been withdrawn for a long time will be recycled.
      state.validatorRegistry.push(validator);
      state.validatorBalances.push(amount);
    } else {
    // Increase balance by deposit amount
      const index = validatorPubkeys.indexOf(pubkey);
      assert(!state.validatorRegistry[index].withdrawalCredentials.equals(withdrawalCredentials), "Deposit already made!");
      state.validatorBalances[index] = state.validatorBalances[index].add(amount);
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
export function validateProofOfPossession(
  state: BeaconState,
  pubkey: BLSPubkey,
  proofOfPossession: BLSSignature,
  withdrawalCredentials: Bytes32): boolean {
    const proofOfPossessionData: DepositInput = {
        pubkey,
        withdrawalCredentials,
        proofOfPossession: EMPTY_SIGNATURE,
    };
    // Stubbed until BLS is a dependency
    // return bls_verify(
    //   pubkey=pubkey,
    //   message=hash_tree_root(proofOfPossessionData),
    //   signature=proofOfPossession,
    //   domain=getDomain(
    //       state.fork,
    //       getCurrentEpoch(state),
    //       DEPOSIT,
    //   )
    return true;
}
