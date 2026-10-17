import {ApiClient, ApiError, routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH, isForkPostGloas} from "@lodestar/params";
import {IClock, computeEpochAtSlot, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Epoch, RootHex, Slot, gloas} from "@lodestar/types";
import {fromHex, toPubkeyHex} from "@lodestar/utils";
import {Metrics} from "../metrics.js";
import {LoggerVc} from "../util/index.js";
import {BlockDutiesService} from "./blockDuties.js";
import {SyncingStatusTracker} from "./syncingStatusTracker.js";
import {ValidatorStore} from "./validatorStore.js";

/**
 * Submit the preferences of next epoch's proposals from this slot of the current epoch on.
 *
 * Their dependent root is the last block of the previous epoch, which a proposer boost reorg
 * at the epoch boundary can still orphan in the first slots. Preferences of the current epoch
 * depend on a block one epoch deeper and are submitted as soon as the duties are known.
 */
const NEXT_EPOCH_SUBMISSION_SLOT = Math.floor(SLOTS_PER_EPOCH / 2);

/** Per-epoch tracking of preferences already submitted under the current dependent_root. */
type SubmittedAtEpoch = {dependentRoot: RootHex; proposerSlots: Set<Slot>; builderSlots: Set<Slot>};
type PendingSubmission = {submission: SubmittedAtEpoch; slot: Slot};
/** An upcoming local proposal along with the tracking of its epoch */
type UpcomingProposal = {duty: routes.validator.ProposerDuty; submission: SubmittedAtEpoch};

/**
 * Signs and submits the preferences of the upcoming local proposals of the current and the next epoch:
 * the `SignedProposerPreferences` the beacon node broadcasts on gossip and the builder preferences
 * it forwards to the builders configured for the validator. Signing the builder request auths here
 * also pre-fills the auth cache used at proposal time.
 *
 * Re-submits automatically when the proposer dependent root for an epoch shifts (e.g. after a reorg)
 * since the proposer for a slot may have changed. Detected by comparing the cached `dependentRoot`
 * reported by `BlockDutiesService` against the one we last submitted under.
 *
 * Proposers should broadcast their preferences before the fork so the proposer preference caches
 * of beacon nodes and builders are warm for the first Gloas slots. The preferences of the first
 * Gloas epoch are submitted from the middle of the epoch before the fork.
 */
export class ProposalPreferencesService {
  private readonly submitted = new Map<Epoch, SubmittedAtEpoch>();
  private activeScheduledGasLimit: number | undefined;

  constructor(
    private readonly config: ChainForkConfig,
    private readonly logger: LoggerVc,
    private readonly api: ApiClient,
    clock: IClock,
    private readonly validatorStore: ValidatorStore,
    private readonly blockDutiesService: BlockDutiesService,
    syncingStatusTracker: SyncingStatusTracker,
    _metrics: Metrics | null
  ) {
    clock.runEverySlot(this.runPreferencesTask);
    clock.runEveryEpoch(this.runEveryEpochTask);
    syncingStatusTracker.runOnResynced(this.onResynced);
  }

  /**
   * A beacon node that was unreachable or syncing may have restarted and lost the preferences it
   * accepted. Submit all upcoming preferences again, the beacon node ignores the ones it still has.
   */
  private onResynced = async (slot: Slot): Promise<void> => {
    if (this.submitted.size === 0) {
      return;
    }

    this.logger.verbose("Beacon node resynced; resubmitting preferences", {slot});
    this.submitted.clear();
    await this.runPreferencesTask(slot);
  };

  private runPreferencesTask = async (slot: Slot): Promise<void> => {
    // Start running in the epoch before the fork so builders can prepare bids for the first Gloas slots
    const currentEpoch = computeEpochAtSlot(slot);
    if (!isForkPostGloas(this.config.getForkName(computeStartSlotAtEpoch(currentEpoch + 1)))) {
      return;
    }

    const proposals = this.getUpcomingProposals(slot);
    if (proposals.length === 0) {
      return;
    }

    // Signed and submitted independently, a slow signer for one must not delay the other
    await Promise.all([
      this.submitProposerPreferences(proposals, slot),
      this.submitBuilderPreferences(proposals, slot),
    ]);
  };

  private runEveryEpochTask = async (epoch: Epoch): Promise<void> => {
    const scheduledGasLimit = this.config.getScheduledGasLimit(epoch);
    if (scheduledGasLimit !== undefined && scheduledGasLimit !== this.activeScheduledGasLimit) {
      const configuredDefaultGasLimit = this.validatorStore.getConfiguredDefaultGasLimit();
      this.logger.info("Gas limit schedule active", {
        epoch,
        recommendedGasLimit: scheduledGasLimit,
        effectiveDefaultGasLimit: configuredDefaultGasLimit ?? scheduledGasLimit,
        defaultGasLimitSource: configuredDefaultGasLimit === undefined ? "schedule" : "operator",
      });
      this.activeScheduledGasLimit = scheduledGasLimit;
    }

    // Drop tracking for past epochs; only currentEpoch and currentEpoch + 1 are ever processed.
    for (const trackedEpoch of this.submitted.keys()) {
      if (trackedEpoch < epoch) {
        this.submitted.delete(trackedEpoch);
      }
    }
  };

  /** Resets the tracking of `epoch` if the dependent root shifted, previously submitted preferences are stale. */
  private getSubmissionAtEpoch(epoch: Epoch, dependentRoot: RootHex): SubmittedAtEpoch {
    let submission = this.submitted.get(epoch);
    if (submission === undefined || submission.dependentRoot !== dependentRoot) {
      if (submission !== undefined) {
        this.logger.info("Proposer-shuffling dependent root shifted; resubmitting preferences", {
          epoch,
          priorDependentRoot: submission.dependentRoot,
          dependentRoot,
        });
      }
      submission = {dependentRoot, proposerSlots: new Set(), builderSlots: new Set()};
      this.submitted.set(epoch, submission);
    }
    return submission;
  }

  private getUpcomingProposals(slot: Slot): UpcomingProposal[] {
    const currentEpoch = computeEpochAtSlot(slot);
    const nextEpochSubmissionSlot = computeStartSlotAtEpoch(currentEpoch) + NEXT_EPOCH_SUBMISSION_SLOT;
    const proposals: UpcomingProposal[] = [];

    for (const epoch of [currentEpoch, currentEpoch + 1]) {
      if (epoch > currentEpoch && slot < nextEpochSubmissionSlot) continue;

      const dutiesAtEpoch = this.blockDutiesService.getProposersAtEpoch(epoch);
      if (!dutiesAtEpoch) continue;

      const submission = this.getSubmissionAtEpoch(epoch, dutiesAtEpoch.dependentRoot);

      for (const duty of dutiesAtEpoch.data) {
        if (duty.slot <= slot) continue;
        if (!isForkPostGloas(this.config.getForkName(duty.slot))) continue;

        proposals.push({duty, submission});
      }
    }

    return proposals;
  }

  private async submitProposerPreferences(proposals: UpcomingProposal[], slot: Slot): Promise<void> {
    const signedProposerPreferences: gloas.SignedProposerPreferences[] = [];
    // Track which `(submission, slot)` pairs are pending an API submission so we can mark
    // them only after the network call succeeds. Marking before would silently drop a
    // preference on transient API failure (no retry until dependent_root shifts).
    const pending: PendingSubmission[] = [];

    for (const {duty, submission} of proposals) {
      if (submission.proposerSlots.has(duty.slot)) continue;

      try {
        const pubkeyHex = toPubkeyHex(duty.pubkey);
        const signed = await this.validatorStore.signProposerPreferences(
          duty,
          fromHex(submission.dependentRoot),
          this.validatorStore.getFeeRecipient(pubkeyHex),
          this.validatorStore.getGasLimit(pubkeyHex, duty.slot, this.logger),
          slot
        );
        signedProposerPreferences.push(signed);
        pending.push({submission, slot: duty.slot});
      } catch (e) {
        this.logger.error(
          "Error signing proposer preferences",
          {slot: duty.slot, validatorIndex: duty.validatorIndex},
          e as Error
        );
      }
    }

    if (signedProposerPreferences.length === 0) {
      return;
    }

    try {
      (await this.api.validator.submitProposerPreferences({signedProposerPreferences})).assertOk();
      // Only mark as submitted after the API call succeeds; a thrown error leaves the
      // slot eligible for retry on the next tick.
      for (const {submission, slot: submittedSlot} of pending) {
        submission.proposerSlots.add(submittedSlot);
      }
      this.logger.debug("Submitted signed proposer preferences", {count: signedProposerPreferences.length});
    } catch (e) {
      const failures = e instanceof ApiError ? e.failures : undefined;
      if (failures === undefined) {
        this.logger.error(
          "Error submitting signed proposer preferences",
          {count: signedProposerPreferences.length},
          e as Error
        );
        return;
      }

      // The beacon node rejected some of the preferences, reported by index into the batch.
      // Mark the accepted ones, the rejected ones are retried on the next tick.
      const failedIndices = new Set(failures.map(({index}) => index));
      pending.forEach(({submission, slot: submittedSlot}, index) => {
        if (!failedIndices.has(index)) {
          submission.proposerSlots.add(submittedSlot);
        }
      });
      for (const {index, message} of failures) {
        this.logger.error("Error submitting signed proposer preferences", {
          slot: pending[index]?.slot,
          validatorIndex: signedProposerPreferences[index]?.message.validatorIndex,
          message,
        });
      }
    }
  }

  private async submitBuilderPreferences(proposals: UpcomingProposal[], slot: Slot): Promise<void> {
    const builderPreferences: routes.validator.BuilderPreferencesEntry[] = [];
    const pending: PendingSubmission[] = [];
    // Index into `pending` of each entry in `builderPreferences`, a proposal has one entry per builder
    const pendingIndexByEntry: number[] = [];

    for (const {duty, submission} of proposals) {
      if (submission.builderSlots.has(duty.slot)) continue;

      const pubkeyHex = toPubkeyHex(duty.pubkey);
      const {selection} = this.validatorStore.getBuilderSelectionParams(pubkeyHex, duty.slot);
      if (selection === routes.validator.BuilderSelection.ExecutionOnly) continue;

      const builderEntries = this.validatorStore.getResolvedBuilderEntries(pubkeyHex);
      if (builderEntries.length === 0) continue;

      try {
        // Collect entries per duty and only add them to the batch if signing
        // succeeded for all builders, else the duty is retried on the next tick
        const dutyEntries: routes.validator.BuilderPreferencesEntry[] = [];
        for (const entry of builderEntries) {
          const auth = await this.validatorStore.getBuilderRequestAuth(duty.pubkey, entry.authData, duty.slot, slot);
          dutyEntries.push({
            proposerPubkey: duty.pubkey,
            url: new TextEncoder().encode(entry.url),
            auth,
            maxExecutionPayment: entry.maxExecutionPayment,
          });
        }
        builderPreferences.push(...dutyEntries);
        pendingIndexByEntry.push(...dutyEntries.map(() => pending.length));
        pending.push({submission, slot: duty.slot});
      } catch (e) {
        this.logger.error(
          "Error signing builder preferences",
          {slot: duty.slot, validatorIndex: duty.validatorIndex},
          e as Error
        );
      }
    }

    if (builderPreferences.length === 0) {
      return;
    }

    try {
      (await this.api.validator.submitBuilderPreferences({builderPreferences})).assertOk();
      // Only mark as submitted after the API call succeeds; a thrown error, including per-entry
      // failures reported by index, leaves all slots eligible for retry on the next tick.
      // Re-submitting preferences a builder already accepted is harmless.
      for (const {submission, slot: submittedSlot} of pending) {
        submission.builderSlots.add(submittedSlot);
      }
      this.logger.debug("Submitted builder preferences", {count: builderPreferences.length});
    } catch (e) {
      const failures = e instanceof ApiError ? e.failures : undefined;
      if (failures === undefined) {
        this.logger.warn("Error submitting builder preferences", {count: builderPreferences.length}, e as Error);
        return;
      }

      // Some entries were not accepted by their builder, reported by index into the batch. Mark the
      // proposals whose entries were all accepted, the others are retried with all their builders.
      const failedPendingIndices = new Set(failures.map(({index}) => pendingIndexByEntry[index]));
      pending.forEach(({submission, slot: submittedSlot}, index) => {
        if (!failedPendingIndices.has(index)) {
          submission.builderSlots.add(submittedSlot);
        }
      });
      for (const {index, message} of failures) {
        this.logger.warn("Error submitting builder preferences", {
          slot: pending[pendingIndexByEntry[index]]?.slot,
          builder: builderPreferences[index] ? new TextDecoder().decode(builderPreferences[index].url) : undefined,
          message,
        });
      }
    }
  }
}
