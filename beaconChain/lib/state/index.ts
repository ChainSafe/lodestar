import { BeaconState, CrosslinkRecord, ValidatorRecord } from "../../interfaces/state"
import {Deposit, DepositInput} from "../../interfaces/blocks";
import {
  INITIAL_SLOT_NUMBER, INITIAL_FORK_VERSION, ZERO_HASH, LATEST_RANDAO_MIXES_LENGTH, EPOCH_LENGTH, SHARD_COUNT,
  LATEST_BLOCK_ROOTS_LENGTH, ZERO_BALANCE_VALIDATOR_TTL, EMPTY_SIGNATURE, MAX_DEPOSIT, GWEI_PER_ETH
} from "../../constants/constants";
import {ValidatorRegistryDeltaFlags, ValidatorStatusCodes} from "../../constants/enums";
import {getEffectiveBalance, getNewShuffling} from "../../helpers/stateTransitionHelpers";

type int = number;
type bytes = Uint8Array;
type hash32 = Uint8Array;

function getInitialBeaconState(initialValidatorDeposits: Deposit[], genesisTime: int, processedPowReceiptRoot: hash32): BeaconState {
    // Weird behaviour, could not set these explicitly for latestCrosslinks
    const initialCrosslinkRecord: CrosslinkRecord = {
        slot: INITIAL_SLOT_NUMBER,
        shardBlockHash: ZERO_HASH
    };

    const state: BeaconState = {
        // MISC
        slot: INITIAL_SLOT_NUMBER,
        genesisTime: genesisTime,
        forkData: {
            preForkVersion: INITIAL_FORK_VERSION,
            postForkVersion: INITIAL_FORK_VERSION,
            forkSlot: INITIAL_SLOT_NUMBER
        },
        // Validator registry
        validatorRegistry: [],
        validatorBalances: [],
        validatorRegistryLatestChangeSlot: INITIAL_SLOT_NUMBER,
        validatorRegistryExitCount: 0,
        validatorRegistryDeltaChainTip: ZERO_HASH,

        // Randomness and committees
        latestRandaoMixes: Array.from({length: LATEST_RANDAO_MIXES_LENGTH}, () => ZERO_HASH),
        latestVdfOutputs: Array.from({length: Math.floor(LATEST_RANDAO_MIXES_LENGTH / EPOCH_LENGTH)}, () => ZERO_HASH),
        shardCommitteesAtSlots: [],
        // Custody Challenges
        custodyChallenges: [],

        // Finality
        previousJustifiedSlot: INITIAL_SLOT_NUMBER,
        justifiedSlot: INITIAL_SLOT_NUMBER,
        justificationBitfield: 0,
        finalizedSlot: INITIAL_SLOT_NUMBER,

        // Recent state
        latestCrosslinks: Array.from({length: SHARD_COUNT}, () => initialCrosslinkRecord),
        latestBlockRoots: Array.from({length: LATEST_BLOCK_ROOTS_LENGTH}, () => ZERO_HASH),
        latestPenalizedExitBalances: [],
        latestAttestations: [],
        batchedBlockRoots: [],

        // PoW receipt root
        processedPowReceiptRoot: processedPowReceiptRoot,
        candidatePowReceiptRoots: []
    };

    // handle initial deposits and activations
    initialValidatorDeposits.forEach(deposit => {
        const validatorIndex = processDeposit(
          state,
          deposit.depositData.depositInput.pubkey,
          deposit.depositData.value,
          deposit.depositData.depositInput.proofOfPossession,
          deposit.depositData.depositInput.withdrawalCredentials,
          deposit.depositData.depositInput.randaoCommitment,
          deposit.depositData.depositInput.custodyCommitment
        );
      if (getEffectiveBalance(state, validatorIndex) === MAX_DEPOSIT * GWEI_PER_ETH) {
          // Async??
          updateValidatorStatus(state, validatorIndex, ValidatorStatusCodes.ACTIVE);
      }
    });

    // Set initial committee shuffling
    const intialShuffling = getNewShuffling(ZERO_HASH, state.validatorRegistry, 0);
    state.shardCommitteesAtSlots = intialShuffling.concat(intialShuffling);
    return state;
}

function processDeposit(state: BeaconState, pubkey: int, deposit: int, proofOfPossession: bytes[], withdrawalCredentials: hash32, randaoCommitment: hash32, custodyCommitment: hash32): int {
    // Process a deposit from Ethereum 1.0.
    // Note that this function mutates state.

    // Validate the given proofOfPossession
    // const proof = validateProofOfPossession(state, pubkey, proofOfPossession, withdrawalCredentials, randaoCommitment, custodyCommitment);
    // if (!proof) throw new Error();
    const validatorPubkeys = state.validatorRegistry.map(v => { return v.pubkey });
    let index: int;
    if (!validatorPubkeys.includes(pubkey)) {
        // Add new validator
        const validator: ValidatorRecord = {
            pubkey: pubkey,
            withdrawalCredentials: withdrawalCredentials,
            randaoCommitment: randaoCommitment,
            randaoLayers: 0,
            status: ValidatorStatusCodes.PENDING_ACTIVATION,
            latestStatusChangeSlot: state.slot,
            exitCount: 0,
            custodyCommitment: custodyCommitment,
            latestCustodyReseedSlot: INITIAL_SLOT_NUMBER,
            penultimateCustodyResseedSlot: INITIAL_SLOT_NUMBER
        };
        index = minEmptyValidatorIndex(state.validatorRegistry, state.validatorBalances, state.slot);
        if (index === null) {
            state.validatorRegistry.push(validator);
            state.validatorBalances.push(deposit);
            index = state.validatorRegistry.length - 1;
        } else {
            state.validatorRegistry[index] = validator;
            state.validatorBalances[index] = deposit;
        }
    } else {
        // Increase balance by deposit
        let index = validatorPubkeys.indexOf(pubkey);
        if(state.validatorRegistry[index].withdrawalCredentials === withdrawalCredentials) throw new Error();

        state.validatorBalances[index] += deposit;
    }
    return index;
}

function minEmptyValidatorIndex(validators: ValidatorRecord[], validatorBalances: int[], currentSlot: int): int | null {
    for (let i: number = 0; i < validators.length; i++) {
        if(validatorBalances[i] === 0 && (validators[i].latestStatusChangeSlot + ZERO_BALANCE_VALIDATOR_TTL <= currentSlot)) return i;
    }
    return null;
};

function validateProofOfPossession(state: BeaconState, pubkey: int, proofOfPossession: bytes, withdrawalCredentials: hash32, randaoCommitment: hash32, custodyCommitment: hash32): boolean {
    const proofOfPossessionData: DepositInput = {
        pubkey: pubkey,
        withdrawalCredentials: withdrawalCredentials,
        randaoCommitment: randaoCommitment,
        custodyCommitment: custodyCommitment,
        proofOfPossession: EMPTY_SIGNATURE
    };
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
};

function updateValidatorStatus(state: BeaconState, index: int, newStatus: int): void {
    // Update the validator status with the given ``index`` to ``new_status``.
    // Handle other general accounting related to this status update.
    // Note that this function mutates ``state``.
    if (newStatus === ValidatorStatusCodes.ACTIVE) {
      activateValidator(state, index);
    }
    // } else if (newStatus === ValidatorStatusCodes.ACTIVE_PENDING_EXIT){
    //     inititateValidatorExit(state, index);
    // } else if (newStatus === ValidatorStatusCodes.EXITED_WITH_PENALTY || newStatus === ValidatorStatusCodes.EXITED_WITHOUT_PENALTY) {
    //     exitValidator(state, index, newStatus);
    // }
}

function activateValidator(state: BeaconState, index: int): void {
    // Activate the validator with the given ``index``
    // Note  this function mutates state
    const validator: ValidatorRecord = state.validatorRegistry[index];
    if (validator.status != ValidatorStatusCodes.PENDING_ACTIVATION) return;

    validator.status = ValidatorStatusCodes.ACTIVE;
    validator.latestStatusChangeSlot = state.slot;
    // state.validatorRegistryDeltaChainTip = getNewValidatorRegistryDeltaChainTip(
    //   state.validatorRegistryDeltaChainTip,
    //   index,
    //   validator.pubkey,
    //   ValidatorRegistryDeltaFlags.ACTIVATION
    // )
}
