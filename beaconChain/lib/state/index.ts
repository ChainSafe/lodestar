import { BeaconState, CrosslinkRecord, ValidatorRecord } from "../../interfaces/state"
import {Deposit, DepositInput} from "../../interfaces/blocks";
import {
  ZERO_HASH, LATEST_RANDAO_MIXES_LENGTH, EPOCH_LENGTH, SHARD_COUNT,
  LATEST_BLOCK_ROOTS_LENGTH, EMPTY_SIGNATURE, MAX_DEPOSIT, GWEI_PER_ETH,
  WHISTLEBLOWER_REWARD_QUOTIENT, GENESIS_SLOT, GENESIS_FORK_VERSION,
  GENESIS_START_SHARD, LATEST_PENALIZED_EXIT_LENGTH, FAR_FUTURE_SLOT, ENTRY_EXIT_DELAY
} from "../../constants/constants";
import {getBeaconProposerIndex, getEffectiveBalance } from "../../helpers/stateTransitionHelpers";
import {StatusFlags} from "../../constants/enums";

type int = number;
type bytes = Uint8Array;
type hash32 = Uint8Array;
type uint384 = number;

/**
 * Generates the initial state for slot 0. This should be called after the ChainStart log has been emitted.
 * @param {Deposit[]} initialValidatorDeposits
 * @param {int} genesisTime
 * @param {hash32} processedPowReceiptRoot
 * @returns {BeaconState}
 */
function getInitialBeaconState(initialValidatorDeposits: Deposit[], genesisTime: int, latestDepositRoot: hash32): BeaconState {
    const initialCrosslinkRecord: CrosslinkRecord = {
        slot: INITIAL_SLOT_NUMBER,
        shardBlockRoot: ZERO_HASH
    };

    const state: BeaconState = {
        // MISC
        slot: GENESIS_SLOT,
        genesisTime: genesisTime,
        forkData: {
            preForkVersion: GENESIS_FORK_VERSION,
            postForkVersion: GENESIS_FORK_VERSION,
            forkSlot: GENESIS_SLOT
        },
        // Validator registry
        validatorRegistry: [],
        validatorBalances: [],
        validatorRegistryLatestChangeSlot: GENESIS_SLOT,
        validatorRegistryExitCount: 0,
        validatorRegistryDeltaChainTip: ZERO_HASH,

        // Randomness and committees
        latestRandaoMixes: Array.from({length: LATEST_RANDAO_MIXES_LENGTH}, () => ZERO_HASH),
        latestVdfOutputs: Array.from({length: Math.floor(LATEST_RANDAO_MIXES_LENGTH / EPOCH_LENGTH)}, () => ZERO_HASH),
        previousEpochStartShard: GENESIS_START_SHARD,
        currentEpochStartShard: GENESIS_START_SHARD,
        previousEpochCalculationSlot: GENESIS_SLOT,
        currentEpochCalculationSlot: GENESIS_SLOT,
        previousEpochRandaoMix: ZERO_HASH,
        currentEpochRandaoMix: ZERO_HASH,

        // Custody Challenges
        custodyChallenges: [],

        // Finality
        previousJustifiedSlot: GENESIS_SLOT,
        justifiedSlot: GENESIS_SLOT,
        justificationBitfield: 0,
        finalizedSlot: GENESIS_SLOT,

        // Recent state
        latestCrosslinks: Array.from({length: SHARD_COUNT}, () => initialCrosslinkRecord),
        latestBlockRoots: Array.from({length: LATEST_BLOCK_ROOTS_LENGTH}, () => ZERO_HASH),
        latestPenalizedExitBalances: Array.from({length: LATEST_PENALIZED_EXIT_LENGTH}, () => 0),
        latestAttestations: [],
        batchedBlockRoots: [],

        // PoW receipt root
        latestDepositRoot: latestDepositRoot,
        depositRootVotes: [],
    };

    // Process initial deposists
    initialValidatorDeposits.forEach(deposit => {
        const validatorIndex = processDeposit(
          state,
          deposit.depositData.depositInput.pubkey,
          deposit.depositData.amount,
          deposit.depositData.depositInput.proofOfPossession,
          deposit.depositData.depositInput.withdrawalCredentials,
          deposit.depositData.depositInput.randaoCommitment,
          deposit.depositData.depositInput.custodyCommitment
        );
    });

    // Process initial activations
    for (let i: number = 0; i < state.validatorRegistry.length; i ++) {
      if (getEffectiveBalance(state, i) === MAX_DEPOSIT * GWEI_PER_ETH) {
        updateValidatorStatus(state, i, true);
      }
    }
    return state;
}

/**
 * Process deposits from ETH1.x chain to ETH2.0 chain
 * @param {BeaconState} state
 * @param {int} pubkey
 * @param {int} amount
 * @param {uint384[]} proofOfPossession
 * @param {hash32} withdrawalCredentials
 * @param {hash32} randaoCommitment
 * @param {hash32} custodyCommitment
 */
function processDeposit(state: BeaconState, pubkey: int, amount: int, proofOfPossession: uint384[], withdrawalCredentials: hash32, randaoCommitment: hash32, custodyCommitment: hash32): void {
    // Process a deposit from Ethereum 1.0.
    // Note that this function mutates state.

    // Validate the given proofOfPossession
    const proof = validateProofOfPossession(state, pubkey, proofOfPossession, withdrawalCredentials, randaoCommitment, custodyCommitment);
    if (!proof) throw new Error();

    const validatorPubkeys = state.validatorRegistry.map(v => { return v.pubkey });

    if (!validatorPubkeys.includes(pubkey)) {
      // Add new validator
      const validator: ValidatorRecord = {
        pubkey: pubkey,
        withdrawalCredentials: withdrawalCredentials,
        randaoCommitment: randaoCommitment,
        randaoLayers: 0,
        activationSlot: FAR_FUTURE_SLOT,
        exitSlot: FAR_FUTURE_SLOT,
        withdrawalSlot: FAR_FUTURE_SLOT,
        penalizedSlot: FAR_FUTURE_SLOT,
        exitCount: 0,
        statusFlags: 0,
        custodyCommitment: custodyCommitment,
        latestCustodyReseedSlot: GENESIS_SLOT,
        penultimateCustodyResseedSlot: GENESIS_SLOT
      };
      const index = state.validatorRegistry.length;
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
 * Validate the deposit
 * @param {BeaconState} state
 * @param {int} pubkey
 * @param {uint384[]} proofOfPossession
 * @param {hash32} withdrawalCredentials
 * @param {hash32} randaoCommitment
 * @param {hash32} custodyCommitment
 * @returns {boolean}
 */
function validateProofOfPossession(state: BeaconState, pubkey: int, proofOfPossession: uint384[], withdrawalCredentials: hash32, randaoCommitment: hash32, custodyCommitment: hash32): boolean {
    // const proofOfPossessionData: DepositInput = {
    //     pubkey: pubkey,
    //     withdrawalCredentials: withdrawalCredentials,
    //     randaoCommitment: randaoCommitment,
    //     custodyCommitment: custodyCommitment,
    //     proofOfPossession: EMPTY_SIGNATURE
    // };
    // Stubbed due to bls not yet a dependency
    // return bls_verify(
    //   pubkey=pubkey,
    //   message=hash_tree_root(proof_of_possession_data),
    //   signature=proof_of_possession,
    //   domain=get_domain(
    //       state.fork_data,
    //       state.slot,
    //       DOMAIN_DEPOSIT,
    //   )
    return true;
}

/**
 * Activate the validator with the given ``index``
 * Note: this function mutates state
 * @param {BeaconState} state
 * @param {int} index
 * @param {boolean} genesis
 */
function activateValidator(state: BeaconState, index: int, genesis: boolean): void {
    const validator: ValidatorRecord = state.validatorRegistry[index];

    validator.activationSlot = genesis ? GENESIS_SLOT : state.slot + ENTRY_EXIT_DELAY;
    // Stubbed due to SSZ
    // state.validator_registry_delta_chain_tip = hash_tree_root(
    //   ValidatorRegistryDeltaBlock(
    //     latest_registry_delta_root=state.validator_registry_delta_chain_tip,
    //     validator_index=index,
    //     pubkey=validator.pubkey,
    //     slot=validator.activation_slot,
    //     flag=ACTIVATION,
    //   )
    // )
}

/**
 * Initiate exit for the validator with the given ``index``.
 * Note: that this function mutates ``state``.
 * @param {BeaconState} state
 * @param {int} index
 */
function initiateValidatorExit(state: BeaconState, index: int): void {
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
function exitValidator(state: BeaconState, index: int): void {
    const validator = state.validatorRegistry[index];

    // The foillowing updates only occur if not previous exited
  if (validator.exitSlot <= state.slot + ENTRY_EXIT_DELAY) {
      return;
  }

  validator.exitSlot = state.slot + ENTRY_EXIT_DELAY;

  state.validatorRegistryExitCount += 1;
  validator.exitCount = state.validatorRegistryExitCount;
  // Stubbed due to SSZ
  // state.validator_registry_delta_chain_tip = hash_tree_root(
  //   ValidatorRegistryDeltaBlock(
  //     latest_registry_delta_root=state.validator_registry_delta_chain_tip,
  //     validator_index=index,
  //     pubkey=validator.pubkey,
  //     slot=validator.exit_slot,
  //     flag=EXIT,
  //   )
  // )
}

/**
 * Penalize bad acting validator
 * @param {BeaconState} state
 * @param {int} index
 */
function penalizeValidator(state: BeaconState, index: int): void {
    exitValidator(state, index);
    const validator = state.validatorRegistry[index];
    state.latestPenalizedExitBalances[Math.floor(state.slot / EPOCH_LENGTH) % LATEST_PENALIZED_EXIT_LENGTH] += getEffectiveBalance(state, index);

    const whistleblowerIndex = getBeaconProposerIndex(state, state.slot);
    const whistleblowerReward = Math.floor(getEffectiveBalance(state, index) / WHISTLEBLOWER_REWARD_QUOTIENT);
    state.validatorBalances[whistleblowerIndex] += whistleblowerReward;
    state.validatorBalances[index] -= whistleblowerReward;
    validator.penalizedSlot = state.slot;
}

/**
 * Prepare the validator for an exit
 * @param {BeaconState} state
 * @param {int} index
 */
function prepareValidatorForWithdrawal(state: BeaconState, index: int): void {
  const validator = state.validatorRegistry[index];
  if (!validator.statusFlags) {
    validator.statusFlags = StatusFlags.WITHDRAWABLE;
  }
}
