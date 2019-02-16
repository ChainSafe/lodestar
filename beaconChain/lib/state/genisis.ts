import BN from "bn.js";
import {generateSeed, getActiveValidatorIndices, getEffectiveBalance} from "../../helpers/stateTransitionHelpers";
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
  MAX_DEPOSIT_AMOUNT, LATEST_INDEX_ROOTS_LENGTH, StatusFlag,
} from "../../constants";
import {activateValidator, hashTreeRoot, processDeposit} from "./index";

type int = number;

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
    genesisTime: new BN(genesisTime),
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
    justificationBitfield: new BN(0),
    finalizedEpoch: GENESIS_EPOCH,

    // Recent state
    latestCrosslinks: Array.from({length: SHARD_COUNT}, () => initialCrosslinkRecord),
    latestBlockRoots: Array.from({length: LATEST_BLOCK_ROOTS_LENGTH}, () => ZERO_HASH),
    latestIndexRoots: Array.from({length: LATEST_INDEX_ROOTS_LENGTH}, () => ZERO_HASH),
    latestPenalizedBalances: Array.from({length: LATEST_PENALIZED_EXIT_LENGTH}, () => new BN(0)),
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
  // TODO For loop is stubbed, should not cast .toNumber()
  for (let i = 0; i< state.validatorRegistry.length; i ++) {
    if (getEffectiveBalance(state, i) >= MAX_DEPOSIT_AMOUNT) {
      activateValidator(state, new BN(i), true);
    }
  }

  const genesisActiveIndexRoot = hashTreeRoot(getActiveValidatorIndices(state.validatorRegistry, GENESIS_EPOCH));
  for (let index: number; index < LATEST_INDEX_ROOTS_LENGTH; index++) {
    state.latestIndexRoots[index] = genesisActiveIndexRoot;
  }
  state.currentEpochSeed = generateSeed(state, GENESIS_EPOCH);
  return state;
}
