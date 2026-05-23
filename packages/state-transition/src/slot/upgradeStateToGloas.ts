import {SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {PubkeyHex, electra, ssz} from "@lodestar/types";
import {toPubkeyHex} from "@lodestar/utils";
import {applyDepositForBuilder, verifyDepositSignatures} from "../block/processDepositRequest.js";
import {getCachedBeaconState} from "../cache/stateCache.js";
import {CachedBeaconStateFulu, CachedBeaconStateGloas} from "../types.js";
import {initializePtcWindow, isBuilderWithdrawalCredential} from "../util/gloas.js";
import {isValidatorKnown} from "../util/index.js";
import {PendingDepositsLookup} from "../util/pendingDepositsLookup.js";

/**
 * Upgrade a state from Fulu to Gloas.
 */
export function upgradeStateToGloas(stateFulu: CachedBeaconStateFulu): CachedBeaconStateGloas {
  const {config} = stateFulu;

  ssz.fulu.BeaconState.commitViewDU(stateFulu);
  const stateGloasCloned = stateFulu;

  const stateGloasView = ssz.gloas.BeaconState.defaultViewDU();

  stateGloasView.genesisTime = stateGloasCloned.genesisTime;
  stateGloasView.genesisValidatorsRoot = stateGloasCloned.genesisValidatorsRoot;
  stateGloasView.slot = stateGloasCloned.slot;
  stateGloasView.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: stateFulu.fork.currentVersion,
    currentVersion: config.GLOAS_FORK_VERSION,
    epoch: stateFulu.epochCtx.epoch,
  });
  stateGloasView.latestBlockHeader = stateGloasCloned.latestBlockHeader;
  stateGloasView.blockRoots = stateGloasCloned.blockRoots;
  stateGloasView.stateRoots = stateGloasCloned.stateRoots;
  stateGloasView.historicalRoots = stateGloasCloned.historicalRoots;
  stateGloasView.eth1Data = stateGloasCloned.eth1Data;
  stateGloasView.eth1DataVotes = stateGloasCloned.eth1DataVotes;
  stateGloasView.eth1DepositIndex = stateGloasCloned.eth1DepositIndex;
  stateGloasView.validators = stateGloasCloned.validators;
  stateGloasView.balances = stateGloasCloned.balances;
  stateGloasView.randaoMixes = stateGloasCloned.randaoMixes;
  stateGloasView.slashings = stateGloasCloned.slashings;
  stateGloasView.previousEpochParticipation = stateGloasCloned.previousEpochParticipation;
  stateGloasView.currentEpochParticipation = stateGloasCloned.currentEpochParticipation;
  stateGloasView.justificationBits = stateGloasCloned.justificationBits;
  stateGloasView.previousJustifiedCheckpoint = stateGloasCloned.previousJustifiedCheckpoint;
  stateGloasView.currentJustifiedCheckpoint = stateGloasCloned.currentJustifiedCheckpoint;
  stateGloasView.finalizedCheckpoint = stateGloasCloned.finalizedCheckpoint;
  stateGloasView.inactivityScores = stateGloasCloned.inactivityScores;
  stateGloasView.currentSyncCommittee = stateGloasCloned.currentSyncCommittee;
  stateGloasView.nextSyncCommittee = stateGloasCloned.nextSyncCommittee;
  stateGloasView.latestExecutionPayloadBid.blockHash = stateFulu.latestExecutionPayloadHeader.blockHash;
  stateGloasView.latestExecutionPayloadBid.gasLimit = BigInt(stateFulu.latestExecutionPayloadHeader.gasLimit);
  stateGloasView.latestExecutionPayloadBid.executionRequestsRoot = ssz.electra.ExecutionRequests.hashTreeRoot(
    ssz.electra.ExecutionRequests.defaultValue()
  );
  stateGloasView.nextWithdrawalIndex = stateGloasCloned.nextWithdrawalIndex;
  stateGloasView.nextWithdrawalValidatorIndex = stateGloasCloned.nextWithdrawalValidatorIndex;
  stateGloasView.historicalSummaries = stateGloasCloned.historicalSummaries;
  stateGloasView.depositRequestsStartIndex = stateGloasCloned.depositRequestsStartIndex;
  stateGloasView.depositBalanceToConsume = stateGloasCloned.depositBalanceToConsume;
  stateGloasView.exitBalanceToConsume = stateGloasCloned.exitBalanceToConsume;
  stateGloasView.earliestExitEpoch = stateGloasCloned.earliestExitEpoch;
  stateGloasView.consolidationBalanceToConsume = stateGloasCloned.consolidationBalanceToConsume;
  stateGloasView.earliestConsolidationEpoch = stateGloasCloned.earliestConsolidationEpoch;
  stateGloasView.pendingDeposits = stateGloasCloned.pendingDeposits;
  stateGloasView.pendingPartialWithdrawals = stateGloasCloned.pendingPartialWithdrawals;
  stateGloasView.pendingConsolidations = stateGloasCloned.pendingConsolidations;
  stateGloasView.proposerLookahead = stateGloasCloned.proposerLookahead;
  stateGloasView.ptcWindow = ssz.gloas.PtcWindow.toViewDU(initializePtcWindow(stateFulu));

  for (let i = 0; i < SLOTS_PER_HISTORICAL_ROOT; i++) {
    stateGloasView.executionPayloadAvailability.set(i, true);
  }
  stateGloasView.latestBlockHash = stateFulu.latestExecutionPayloadHeader.blockHash;

  const stateGloas = getCachedBeaconState(stateGloasView, stateFulu);

  // Process pending builder deposits at the fork boundary
  onboardBuildersFromPendingDeposits(stateGloas);

  stateGloas.commit();
  // Clear cache to ensure the cache of fulu fields is not used by new gloas fields
  // biome-ignore lint/complexity/useLiteralKeys: It is a protected attribute
  stateGloas["clearCache"]();

  return stateGloas;
}

/** Verify queued builder deposit signatures in batches of this size. */
const BUILDER_DEPOSIT_BATCH_SIZE = 32;

/**
 * Applies any pending deposits for builders to onboard builders during the fork transition
 * Spec: https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.8/specs/gloas/fork.md#new-onboard_builders_from_pending_deposits
 *
 * New-builder deposits are verified lazily: signatures are queued and batch-verified
 * `BUILDER_DEPOSIT_BATCH_SIZE` at a time.
 */
export function onboardBuildersFromPendingDeposits(state: CachedBeaconStateGloas): void {
  // Map of builder pubkey -> index in `state.builders` for builders already applied in this loop.
  const builderIndexByPubkey = new Map<PubkeyHex, number>();
  // FIFO queue of new-builder deposits awaiting batch signature verification. Holds
  // distinct pubkeys, a reappearing queued pubkey force-flushes the queue first.
  const queuedBuilderDeposits = new Map<PubkeyHex, electra.PendingDeposit>();

  const pendingDeposits = ssz.electra.PendingDeposits.defaultViewDU();
  const pendingDepositsLookup = PendingDepositsLookup.buildEmpty();

  // Batch-verify the queued deposits and apply the ones with valid signatures.
  const flushQueue = (): void => {
    if (queuedBuilderDeposits.size === 0) {
      return;
    }
    const entries = Array.from(queuedBuilderDeposits);
    const validResults = verifyDepositSignatures(
      state.config,
      entries.map(([, deposit]) => deposit)
    );
    for (let j = 0; j < entries.length; j++) {
      if (!validResults[j]) {
        continue;
      }
      const [pubkeyHex, deposit] = entries[j];
      // With direct push (no slot reuse at the fork) the builder lands at the current length
      const builderIndex = state.builders.length;
      applyDepositForBuilder(
        state,
        deposit.pubkey,
        deposit.withdrawalCredentials,
        deposit.amount,
        // signature = null means valid
        null,
        deposit.slot,
        // this is new builder, top up flow was detected below
        null,
        // no previous builders at fork transition so no need to check for reuse
        false
      );
      builderIndexByPubkey.set(pubkeyHex, builderIndex);
    }
    queuedBuilderDeposits.clear();
  };

  for (let i = 0; i < state.pendingDeposits.length; i++) {
    const deposit = state.pendingDeposits.getReadonly(i);

    const validatorIndex = state.epochCtx.getValidatorIndex(deposit.pubkey);
    const pubkeyHex = toPubkeyHex(deposit.pubkey);

    // Deposits for existing validators stay in the pending queue
    if (isValidatorKnown(state, validatorIndex)) {
      pendingDeposits.push(deposit);
      pendingDepositsLookup.add(deposit, pubkeyHex);
      continue;
    }

    // after the flush it is either an applied builder (-> top-up below) or absent (its
    // queued deposit had an invalid signature -> re-evaluated as a fresh candidate).
    // this ensures the functions work the same way to the spec
    if (queuedBuilderDeposits.has(pubkeyHex)) {
      flushQueue();
    }

    // `?? null` is required to keep builder index 0. A known index means a top-up to an
    // already-onboarded builder, applied regardless of withdrawal credential; otherwise
    // this is a candidate new builder and the credential checks below apply.
    const builderIndex = builderIndexByPubkey.get(pubkeyHex) ?? null;

    if (builderIndex === null) {
      // Deposits for non-builders stay in the pending queue. If there is a valid pending
      // deposit for a new validator with this pubkey, keep this deposit in the pending
      // queue to be applied to that validator later.
      if (!isBuilderWithdrawalCredential(deposit.withdrawalCredentials)) {
        pendingDeposits.push(deposit);
        pendingDepositsLookup.add(deposit, pubkeyHex);
        continue;
      }
      if (pendingDepositsLookup.hasPendingValidator(state.config, pubkeyHex)) {
        pendingDeposits.push(deposit);
        pendingDepositsLookup.add(deposit, pubkeyHex);
        continue;
      }

      // New builder candidate: queue it for lazy batch signature verification
      queuedBuilderDeposits.set(pubkeyHex, {
        pubkey: deposit.pubkey,
        withdrawalCredentials: deposit.withdrawalCredentials,
        amount: deposit.amount,
        signature: deposit.signature,
        slot: deposit.slot,
      });
      if (queuedBuilderDeposits.size >= BUILDER_DEPOSIT_BATCH_SIZE) {
        flushQueue();
      }
    } else {
      // Top-up of an already-onboarded builder; no signature verification needed
      applyDepositForBuilder(
        state,
        deposit.pubkey,
        deposit.withdrawalCredentials,
        deposit.amount,
        // top up flow, no need signature verification
        null,
        deposit.slot,
        builderIndex,
        // no previous builders at fork transition so no need to check for reuse
        false
      );
    }
  }

  // Verify and apply any remaining queued builder deposits
  flushQueue();

  state.pendingDeposits = pendingDeposits;
}
