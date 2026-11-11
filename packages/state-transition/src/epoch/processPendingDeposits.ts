import {
  BLS_WITHDRAWAL_PREFIX,
  FAR_FUTURE_EPOCH,
  ForkSeq,
  GENESIS_SLOT,
  MAX_PENDING_DEPOSITS_PER_EPOCH,
} from "@lodestar/params";
import {electra} from "@lodestar/types";
import {addValidatorToRegistry, isValidDepositSignature} from "../block/processDeposit.js";
import {CachedBeaconStateElectra, EpochTransitionCache} from "../types.js";
import {increaseBalance} from "../util/balance.js";
import {hasCompoundingWithdrawalCredential, isValidatorKnown} from "../util/electra.js";
import {computeStartSlotAtEpoch} from "../util/epoch.js";
import {computeDepositPubkey, computeDepositVrfRoot, isLegacyPubkey} from "../util/pq.js";
import {getActivationChurnLimit, getActivationExitChurnLimit} from "../util/validator.js";

/**
 * Starting from Electra:
 * Process pending balance deposits from state subject to churn limit and depositBalanceToConsume.
 * For each eligible `deposit`, call `increaseBalance()`.
 * Remove the processed deposits from `state.pendingDeposits`.
 * Update `state.depositBalanceToConsume` for the next epoch
 *
 * TODO Electra: Update ssz library to support batch push to `pendingDeposits`
 */
export function processPendingDeposits(state: CachedBeaconStateElectra, cache: EpochTransitionCache): void {
  const fork = state.config.getForkSeq(state.slot);
  const nextEpoch = state.epochCtx.epoch + 1;
  const churnLimit =
    fork >= ForkSeq.gloas ? getActivationChurnLimit(state.epochCtx) : getActivationExitChurnLimit(state.epochCtx);
  const availableForProcessing = state.depositBalanceToConsume + BigInt(churnLimit);
  let processedAmount = 0;
  let nextDepositIndex = 0;
  const depositsToPostpone = [];
  let isChurnLimitReached = false;
  const finalizedSlot = computeStartSlotAtEpoch(state.finalizedCheckpoint.epoch);

  let startIndex = 0;
  // TODO: is this a good number?
  const chunk = 100;
  const pendingDepositsLength = state.pendingDeposits.length;
  outer: while (startIndex < pendingDepositsLength) {
    const deposits = state.pendingDeposits.getReadonlyByRange(startIndex, chunk);

    for (const deposit of deposits) {
      // Do not process deposit requests if Eth1 bridge deposits are not yet applied.
      // The eth1 bridge deposit mechanism was removed in Fulu, so this gate only applies pre-Fulu.
      if (
        fork < ForkSeq.fulu &&
        // Is deposit request
        deposit.slot > GENESIS_SLOT &&
        // There are pending Eth1 bridge deposits
        state.eth1DepositIndex < state.depositRequestsStartIndex
      ) {
        break outer;
      }

      // Check if deposit has been finalized, otherwise, stop processing.
      if (deposit.slot > finalizedSlot) {
        break outer;
      }

      // Check if number of processed deposits has not reached the limit, otherwise, stop processing.
      if (nextDepositIndex >= MAX_PENDING_DEPOSITS_PER_EPOCH) {
        break outer;
      }

      // Read validator state
      let isValidatorExited = false;
      let isValidatorWithdrawn = false;

      const validatorIndex = state.epochCtx.getValidatorIndex(depositPubkey(fork, deposit.pubkey));
      if (isValidatorKnown(state, validatorIndex)) {
        const validator = state.validators.getReadonly(validatorIndex);
        isValidatorExited = validator.exitEpoch < FAR_FUTURE_EPOCH;
        isValidatorWithdrawn = validator.withdrawableEpoch < nextEpoch;
      }

      // From pq a legacy deposit's validator never becomes active, so it does not consume churn
      if (isValidatorWithdrawn || (fork === ForkSeq.pq && isLegacyPubkey(deposit.pubkey))) {
        // Deposited balance will never become active. Increase balance but do not consume churn
        applyPendingDeposit(fork, state, deposit, cache);
      } else if (isValidatorExited) {
        // Validator is exiting, postpone the deposit until after withdrawable epoch
        depositsToPostpone.push(deposit);
      } else {
        // Check if deposit fits in the churn, otherwise, do no more deposit processing in this epoch.
        isChurnLimitReached = processedAmount + deposit.amount > availableForProcessing;
        if (isChurnLimitReached) {
          break outer;
        }
        // Consume churn and apply deposit.
        processedAmount += deposit.amount;
        applyPendingDeposit(fork, state, deposit, cache);
      }

      // Regardless of how the deposit was handled, we move on in the queue.
      nextDepositIndex++;
    }

    startIndex += chunk;
  }

  const remainingPendingDeposits = state.pendingDeposits.sliceFrom(nextDepositIndex);
  state.pendingDeposits = remainingPendingDeposits;

  // TODO Electra: add a function in ListCompositeTreeView to support batch push operation
  for (const deposit of depositsToPostpone) {
    state.pendingDeposits.push(deposit);
  }

  // Accumulate churn only if the churn limit has been hit.
  if (isChurnLimitReached) {
    state.depositBalanceToConsume = availableForProcessing - BigInt(processedAmount);
  } else {
    state.depositBalanceToConsume = 0n;
  }
}

/** The key the pubkey cache holds for the validator a deposit names */
function depositPubkey(fork: ForkSeq, pubkey: Uint8Array): Uint8Array {
  return fork === ForkSeq.pq ? computeDepositPubkey(pubkey) : pubkey;
}

function applyPendingDeposit(
  fork: ForkSeq,
  state: CachedBeaconStateElectra,
  deposit: electra.PendingDeposit,
  cache: EpochTransitionCache
): void {
  const validatorIndex = state.epochCtx.getValidatorIndex(depositPubkey(fork, deposit.pubkey));
  const {pubkey, withdrawalCredentials, amount, signature} = deposit;
  const cachedBalances = cache.balances;

  // From pq a deposit carries no signature to check
  if (fork === ForkSeq.pq && !isValidatorKnown(state, validatorIndex)) {
    const vrfRoot = computeDepositVrfRoot(pubkey, signature);
    addValidatorToRegistry(fork, state, computeDepositPubkey(pubkey), withdrawalCredentials, amount, vrfRoot);
    const newValidatorIndex = state.validators.length - 1;
    cache.isCompoundingValidatorArr[newValidatorIndex] = hasCompoundingWithdrawalCredential(withdrawalCredentials);
    if (cachedBalances) {
      cachedBalances[newValidatorIndex] = amount;
    }
    if (isLegacyPubkey(pubkey)) {
      // No signature verifies against a legacy deposit's key: exit its validator at once
      const validator = state.validators.get(newValidatorIndex);
      validator.exitEpoch = state.epochCtx.epoch;
      validator.withdrawableEpoch = state.epochCtx.epoch + state.config.MIN_VALIDATOR_WITHDRAWABILITY_DELAY;
    }
    return;
  }

  if (!isValidatorKnown(state, validatorIndex)) {
    // Do not create validators with BLS withdrawal credentials, the deposit is skipped without a refund
    if (fork >= ForkSeq.heze && withdrawalCredentials[0] === BLS_WITHDRAWAL_PREFIX) {
      return;
    }
    // Verify the deposit signature (proof of possession) which is not checked by the deposit contract
    if (isValidDepositSignature(state.config, pubkey, withdrawalCredentials, amount, signature)) {
      addValidatorToRegistry(ForkSeq.electra, state, pubkey, withdrawalCredentials, amount);
      const newValidatorIndex = state.validators.length - 1;
      cache.isCompoundingValidatorArr[newValidatorIndex] = hasCompoundingWithdrawalCredential(withdrawalCredentials);
      // set balance, so that the next deposit of same pubkey will increase the balance correctly
      // this is to fix the double deposit issue found in mekong
      // see https://github.com/ChainSafe/lodestar/pull/7255
      if (cachedBalances) {
        cachedBalances[newValidatorIndex] = amount;
      }
    }
  } else {
    // Increase balance
    increaseBalance(state, validatorIndex, amount);
    if (cachedBalances) {
      cachedBalances[validatorIndex] += amount;
    }
  }
}
